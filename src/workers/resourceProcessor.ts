/**
 * Resource Processor Worker
 * Background job handler for processing uploaded resources
 * Extracts text, chunks documents, and stores in database
 */

import * as path from 'path';
import { getJobQueue } from '../config/jobQueue';
import { getDatabase } from '../config/database';
import * as resourceService from '../services/resourceService';
import * as documentProcessingService from '../services/documentProcessingService';
import * as embeddingService from '../services/embeddingService';
import logger from '../utils/logger';

// Get upload directory from environment or use default
const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';

/**
 * Job payload for resource processing
 */
export interface ProcessResourceJob {
  resourceId: string;
  campaignId: string;
  filePath: string;
  userId: string;
}

/**
 * Insert chunks into database using batch insert
 */
async function insertChunks(
  db: any,
  resourceId: string,
  chunks: documentProcessingService.Chunk[]
): Promise<void> {
  if (chunks.length === 0) {
    logger.warn('No chunks to insert', { resourceId });
    return;
  }

  try {
    const values = chunks.map((chunk, index) => ({
      resource_id: resourceId,
      chunk_index: index,
      raw_text: chunk.content, 
      token_count: chunk.tokenCount,
      page_number: chunk.pageNumber,
      section_heading: chunk.sectionHeading,
      metadata: JSON.stringify({
        startOffset: chunk.startOffset,
        endOffset: chunk.endOffset,
      }),
    }));

    const pgp = db.$config.pgp;
    const cs = new pgp.helpers.ColumnSet(
      [
        'resource_id',
        'chunk_index',
        'raw_text',
        'token_count',
        'page_number',
        'section_heading',
        { name: 'metadata', cast: 'jsonb' },
      ],
      { table: 'resource_chunks' }
    );

    const query = pgp.helpers.insert(values, cs);
    await db.none(query);

    logger.info('Chunks inserted successfully', {
      resourceId,
      chunkCount: chunks.length,
    });
  } catch (error: any) {
    logger.error('Failed to insert chunks', {
      resourceId,
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

/**
 * Process a single resource job
 */
async function processResourceJob(job: any): Promise<void> {
  const { resourceId, filePath, campaignId, userId } = job.data as ProcessResourceJob;
  const db = getDatabase();

  const startTime = Date.now();

  try {
    logger.info('Starting resource processing', {
      resourceId,
      filePath,
      campaignId,
      userId,
      jobId: job.id,
    });

    await resourceService.updateProcessingStatus(
      db,
      resourceId,
      resourceService.ProcessingStatus.PROCESSING
    );

    await db.none(
      `UPDATE resources
       SET processing_started_at = NOW(),
           processing_retry_count = processing_retry_count + 1
       WHERE id = $1`,
      [resourceId]
    );

    const absoluteFilePath = path.join(process.cwd(), UPLOAD_DIR, filePath);
    
    // Check file extension support
    const ext = path.extname(absoluteFilePath).toLowerCase();
    if (!['.pdf', '.docx', '.txt', '.md'].includes(ext)) {
        throw new Error(`Unsupported file type: ${ext}. Only PDF, DOCX, and TXT are supported.`);
    }

    logger.debug('Extracting text from', { absoluteFilePath, fileType: ext });

    // Extract text (HANDLES PDF, DOCX, TXT)
    const extracted = await documentProcessingService.extractText(absoluteFilePath);

    logger.info('Text extraction completed', {
      resourceId,
      fileType: ext,
      totalPages: extracted.totalPages,
      hasTitle: !!extracted.metadata.title,
    });

    await db.none(
      `UPDATE resources
       SET total_pages = $1,
           title = COALESCE(title, $2),
           author = COALESCE(author, $3),
           metadata = metadata || $4::jsonb
       WHERE id = $5`,
      [
        extracted.totalPages,
        extracted.metadata.title || null,
        extracted.metadata.author || null,
        JSON.stringify({
          subject: extracted.metadata.subject,
          creator: extracted.metadata.creator,
          producer: extracted.metadata.producer,
        }),
        resourceId,
      ]
    );

    logger.debug('Starting document chunking', { resourceId });

    const chunks = await documentProcessingService.chunkDocument(extracted);

    logger.info('Document chunking completed', {
      resourceId,
      chunkCount: chunks.length,
      avgTokenCount: Math.round(
        chunks.reduce((sum, c) => sum + c.tokenCount, 0) / chunks.length
      ),
    });

    await insertChunks(db, resourceId, chunks);

    logger.debug('Retrieving chunk IDs for embedding generation', { resourceId });
    const chunkIds = await db.any(
      'SELECT id, raw_text FROM resource_chunks WHERE resource_id = $1 ORDER BY chunk_index',
      [resourceId]
    );

    logger.info('Generating embeddings for chunks', {
      resourceId,
      chunkCount: chunkIds.length,
    });

    let embeddingsFailed = false;

    try {
      const embeddingResult = await embeddingService.embedChunks(resourceId, chunkIds);

      logger.info('Embeddings generated successfully', {
        resourceId,
        tokensUsed: embeddingResult.tokensUsed,
        estimatedCost: embeddingResult.estimatedCost.toFixed(4),
      });

      await db.none(
        `UPDATE resources
         SET metadata = metadata || $1::jsonb
         WHERE id = $2`,
        [
          JSON.stringify({
            embeddingTokens: embeddingResult.tokensUsed,
            embeddingCost: embeddingResult.estimatedCost,
            embeddingsGenerated: true,
            embeddingGeneratedAt: new Date().toISOString(),
          }),
          resourceId,
        ]
      );
    } catch (error: any) {
      embeddingsFailed = true;

      logger.error('Failed to generate embeddings', {
        resourceId,
        error: error.message,
        stack: error.stack,
        apiKeyConfigured: !!process.env.OPENAI_API_KEY,
      });

      await db.none(
        `UPDATE resources
         SET metadata = metadata || $1::jsonb
         WHERE id = $2`,
        [
          JSON.stringify({
            embeddingsGenerated: false,
            embeddingError: error.message,
            embeddingErrorAt: new Date().toISOString(),
          }),
          resourceId,
        ]
      );
    }

    const duration = Date.now() - startTime;

    const finalStatus = embeddingsFailed
      ? 'completed_no_embeddings'
      : resourceService.ProcessingStatus.COMPLETED;

    await db.none(
      `UPDATE resources
       SET total_chunks = $1,
           ingestion_status = $2,
           processing_completed_at = NOW(),
           processing_duration_ms = $3
       WHERE id = $4`,
      [chunks.length, finalStatus, duration, resourceId]
    );

    if (embeddingsFailed) {
      logger.warn('Resource processing completed but embeddings failed', {
        resourceId,
        status: finalStatus,
        note: 'Embeddings can be regenerated using backfill script',
      });
    }

    logger.info('Resource processing completed successfully', {
      resourceId,
      totalPages: extracted.totalPages,
      chunkCount: chunks.length,
      durationMs: duration,
      jobId: job.id,
    });
  } catch (error: any) {
    const duration = Date.now() - startTime;

    logger.error('Resource processing failed', {
      resourceId,
      error: error.message,
      stack: error.stack,
      durationMs: duration,
      jobId: job.id,
    });

    await resourceService.updateProcessingStatus(
      db,
      resourceId,
      resourceService.ProcessingStatus.FAILED,
      error.message
    );

    await db.none(
      `UPDATE resources
       SET processing_completed_at = NOW(),
           processing_duration_ms = $1
       WHERE id = $2`,
      [duration, resourceId]
    );

    throw error;
  }
}

/**
 * Register the resource processor worker
 */
export async function registerResourceProcessor(): Promise<void> {
  const queue = getJobQueue();

  try {
    await queue.work<ProcessResourceJob>(
      'process-resource',
      {
        teamSize: 5, 
        teamConcurrency: 1, 
      },
      async (job) => {
        try {
          await processResourceJob(job);
        } catch (error: any) {
          logger.error('Job execution failed', {
            jobId: job.id,
            resourceId: job.data.resourceId,
            error: error.message,
          });
          throw error;
        }
      }
    );

    logger.info('Resource processor worker registered', {
      queueName: 'process-resource',
      teamSize: 5,
      teamConcurrency: 1,
    });
  } catch (error: any) {
    logger.error('Failed to register resource processor worker', {
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

/**
 * Get processing statistics
 */
export async function getProcessingStats(): Promise<any> {
  const queue = getJobQueue();

  try {
    const queueSize = await queue.getQueueSize('process-resource');

    return {
      queueName: 'process-resource',
      queueSize,
      timestamp: new Date().toISOString(),
    };
  } catch (error: any) {
    logger.error('Failed to get processing stats', { error: error.message });
    return null;
  }
}