/**
 * Backfill Embeddings Script
 *
 * Generates embeddings for resource chunks that are missing them.
 * Safe to run multiple times (idempotent).
 *
 * Usage:
 *   npm run backfill-embeddings
 *   npm run backfill-embeddings -- --resource-id=<uuid>
 *   npm run backfill-embeddings -- --campaign-id=<uuid>
 *   npm run backfill-embeddings -- --dry-run
 */

import { getDatabase, initDatabase, closeDatabase } from '../config/database';
import * as embeddingService from '../services/embeddingService';
import logger from '../utils/logger';

interface BackfillStats {
  resourcesProcessed: number;
  chunksProcessed: number;
  totalTokens: number;
  totalCost: number;
  errors: number;
}

interface ResourceToBackfill {
  resourceId: string;
  campaignId: string;
  fileName: string;
  chunkCount: number;
}

/**
 * Parse command line arguments
 */
function parseArgs(): {
  resourceId?: string;
  campaignId?: string;
  dryRun: boolean;
} {
  const args = process.argv.slice(2);
  const options: any = { dryRun: false };

  for (const arg of args) {
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg.startsWith('--resource-id=')) {
      options.resourceId = arg.split('=')[1];
    } else if (arg.startsWith('--campaign-id=')) {
      options.campaignId = arg.split('=')[1];
    }
  }

  return options;
}

/**
 * Find all resources with chunks missing embeddings
 */
async function findResourcesNeedingEmbeddings(
  db: any,
  resourceId?: string,
  campaignId?: string
): Promise<ResourceToBackfill[]> {
  let query = `
    SELECT
      r.id as resource_id,
      r.campaign_id,
      r.original_filename as file_name,
      COUNT(rc.id) as chunk_count
    FROM resources r
    JOIN resource_chunks rc ON r.id = rc.resource_id
    WHERE rc.embedding IS NULL
  `;

  const params: any[] = [];
  let paramIndex = 1;

  if (resourceId) {
    query += ` AND r.id = $${paramIndex}`;
    params.push(resourceId);
    paramIndex++;
  }

  if (campaignId) {
    query += ` AND r.campaign_id = $${paramIndex}`;
    params.push(campaignId);
    paramIndex++;
  }

  query += `
    GROUP BY r.id, r.campaign_id, r.original_filename
    ORDER BY r.uploaded_at ASC
  `;

  const results = await db.any(query, params);

  return results.map((row: any) => ({
    resourceId: row.resource_id,
    campaignId: row.campaign_id,
    fileName: row.file_name,
    chunkCount: parseInt(row.chunk_count),
  }));
}

/**
 * Backfill embeddings for a single resource
 */
async function backfillResource(
  db: any,
  resource: ResourceToBackfill,
  dryRun: boolean
): Promise<{ tokens: number; cost: number }> {
  logger.info('Processing resource', {
    resourceId: resource.resourceId,
    fileName: resource.fileName,
    chunkCount: resource.chunkCount,
    dryRun,
  });

  if (dryRun) {
    // Estimate tokens (rough calculation: 1 token per 4 characters)
    const chunks = await db.any(
      'SELECT raw_text FROM resource_chunks WHERE resource_id = $1 AND embedding IS NULL',
      [resource.resourceId]
    );

    const estimatedTokens = chunks.reduce(
      (sum: number, chunk: any) => sum + Math.ceil(chunk.raw_text.length / 4),
      0
    );

    const estimatedCost = embeddingService.calculateEmbeddingCost(estimatedTokens);

    logger.info('Dry run - would generate embeddings', {
      resourceId: resource.resourceId,
      chunkCount: chunks.length,
      estimatedTokens,
      estimatedCost: estimatedCost.toFixed(6),
    });

    return { tokens: estimatedTokens, cost: estimatedCost };
  }

  // Get chunks needing embeddings
  const chunks: Array<{ id: string; raw_text: string }> = await db.any(
    'SELECT id, raw_text FROM resource_chunks WHERE resource_id = $1 AND embedding IS NULL ORDER BY chunk_index',
    [resource.resourceId]
  );

  if (chunks.length === 0) {
    logger.info('No chunks need embeddings (already backfilled?)', {
      resourceId: resource.resourceId,
    });
    return { tokens: 0, cost: 0 };
  }

  // Generate embeddings
  const result = await embeddingService.embedChunks(resource.resourceId, chunks);

  // Update resource metadata
  await db.none(
    `UPDATE resources
     SET metadata = metadata || $1::jsonb,
         ingestion_status = CASE
           WHEN ingestion_status = 'completed_no_embeddings'
           THEN 'completed'
           ELSE ingestion_status
         END
     WHERE id = $2`,
    [
      JSON.stringify({
        embeddingTokens: result.tokensUsed,
        embeddingCost: result.estimatedCost,
        embeddingsGenerated: true,
        embeddingBackfilledAt: new Date().toISOString(),
      }),
      resource.resourceId,
    ]
  );

  logger.info('Resource embeddings backfilled successfully', {
    resourceId: resource.resourceId,
    chunkCount: chunks.length,
    tokensUsed: result.tokensUsed,
    cost: result.estimatedCost.toFixed(6),
  });

  return { tokens: result.tokensUsed, cost: result.estimatedCost };
}

/**
 * Main backfill function
 */
async function backfillEmbeddings(options: {
  resourceId?: string;
  campaignId?: string;
  dryRun: boolean;
}): Promise<BackfillStats> {
  const db = getDatabase();
  const stats: BackfillStats = {
    resourcesProcessed: 0,
    chunksProcessed: 0,
    totalTokens: 0,
    totalCost: 0,
    errors: 0,
  };

  try {
    // Validate OpenAI configuration
    embeddingService.validateConfiguration();

    // Find resources needing backfill
    const resources = await findResourcesNeedingEmbeddings(
      db,
      options.resourceId,
      options.campaignId
    );

    if (resources.length === 0) {
      logger.info('No resources need embedding backfill');
      return stats;
    }

    logger.info('Found resources needing embeddings', {
      count: resources.length,
      totalChunks: resources.reduce((sum, r) => sum + r.chunkCount, 0),
      dryRun: options.dryRun,
    });

    if (options.dryRun) {
      logger.info('DRY RUN MODE - No changes will be made');
    }

    // Process each resource
    for (const resource of resources) {
      try {
        const result = await backfillResource(db, resource, options.dryRun);

        stats.resourcesProcessed++;
        stats.chunksProcessed += resource.chunkCount;
        stats.totalTokens += result.tokens;
        stats.totalCost += result.cost;
      } catch (error: any) {
        stats.errors++;
        logger.error('Failed to backfill resource', {
          resourceId: resource.resourceId,
          error: error.message,
          stack: error.stack,
        });
        // Continue with next resource
      }
    }

    return stats;
  } catch (error: any) {
    logger.error('Backfill failed', {
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

/**
 * CLI entry point
 */
async function main() {
  const options = parseArgs();

  console.log('=== EMBEDDING BACKFILL SCRIPT ===');
  console.log(`Mode: ${options.dryRun ? 'DRY RUN (no changes)' : 'LIVE'}`);
  if (options.resourceId) {
    console.log(`Target: Resource ${options.resourceId}`);
  } else if (options.campaignId) {
    console.log(`Target: Campaign ${options.campaignId}`);
  } else {
    console.log('Target: All resources with missing embeddings');
  }
  console.log('================================\n');

  try {
    // Initialize database
    await initDatabase();
    logger.info('Database initialized');

    // Run backfill
    const stats = await backfillEmbeddings({
      resourceId: options.resourceId,
      campaignId: options.campaignId,
      dryRun: options.dryRun,
    });

    // Print summary
    logger.info('Backfill completed', {
      resourcesProcessed: stats.resourcesProcessed,
      chunksProcessed: stats.chunksProcessed,
      totalTokens: stats.totalTokens,
      totalCost: `$${stats.totalCost.toFixed(6)}`,
      errors: stats.errors,
      dryRun: options.dryRun,
    });

    console.log('\n=== BACKFILL SUMMARY ===');
    console.log(`Resources processed: ${stats.resourcesProcessed}`);
    console.log(`Chunks processed: ${stats.chunksProcessed}`);
    console.log(`Total tokens used: ${stats.totalTokens.toLocaleString()}`);
    console.log(`Estimated cost: $${stats.totalCost.toFixed(6)}`);
    console.log(`Errors: ${stats.errors}`);
    if (options.dryRun) {
      console.log('\n*** DRY RUN - No changes made ***');
    }
    console.log('========================\n');

    await closeDatabase();
    process.exit(stats.errors > 0 ? 1 : 0);
  } catch (error: any) {
    logger.error('Fatal error', { error: error.message });
    console.error('FATAL ERROR:', error.message);
    await closeDatabase();
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

export { backfillEmbeddings, findResourcesNeedingEmbeddings, backfillResource };
