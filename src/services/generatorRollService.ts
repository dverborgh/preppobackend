/**
 * Generator roll service
 * Handles generator roll execution with < 300ms performance guarantee
 * NO LLM CALLS during roll execution - this is critical for gameplay flow
 * Updated to support test mode and optional session validation
 */

import { randomUUID } from 'crypto';
import seedrandom from 'seedrandom';
import { ExtendedDatabase } from '../config/database';
import {
  NotFoundError,
  ValidationError,
  PaginatedResponse,
  GeneratorRoll,
  GeneratorEntry,
} from '../types';
import logger from '../utils/logger';
import { verifyCampaignOwnership } from './campaignService';

// Roll request types
export interface ExecuteRollRequest {
  session_id?: string;
  scene_id?: string;
  seed?: string;
  test_mode?: boolean; // If true, don't log the roll
}

export interface RollResult {
  id?: string; // Only present if not test mode
  generator_id: string;
  generator_name: string;
  rolled_value: Record<string, any>;
  entry_key: string;
  entry_text: string;
  random_seed: string;
  roll_timestamp: Date;
  latency_ms: number;
}

export interface ListRollsOptions {
  sessionId?: string;
  sceneId?: string;
  skip?: number;
  limit?: number;
}

/**
 * Weighted random selection algorithm
 * Time complexity: O(n)
 * Space complexity: O(1)
 *
 * Given entries with weights [10, 30, 50, 10]:
 * 1. Compute totalWeight = 100
 * 2. Generate random number in [0, 100): e.g., 45
 * 3. Iterate cumulative sums: 10, 40, 90, 100
 * 4. Return entry where cumulative > random: entry at index 2 (weight 50)
 */
function weightedRandomSelect(
  entries: GeneratorEntry[],
  rng: () => number
): GeneratorEntry {
  if (entries.length === 0) {
    throw new ValidationError('Cannot select from empty entries list');
  }

  if (entries.length === 1) {
    return entries[0];
  }

  // Calculate total weight
  const totalWeight = entries.reduce((sum, e) => sum + e.weight, 0);

  if (totalWeight === 0) {
    throw new ValidationError('Total weight cannot be zero');
  }

  // Generate random number in [0, totalWeight)
  let random = rng() * totalWeight;

  // Find the entry that corresponds to this random value
  for (const entry of entries) {
    random -= entry.weight;
    if (random <= 0) {
      return entry;
    }
  }

  // Fallback to last entry (should never happen due to floating point)
  return entries[entries.length - 1];
}

/**
 * Generate a cryptographically secure seed from inputs
 */
function generateSeed(generatorId: string, timestamp: number): string {
  return `${timestamp}-${generatorId}-${randomUUID()}`;
}

/**
 * Parse entry_text to extract output JSON
 * Expects entry_text to contain JSON in format: "description text {json data}"
 * Or just returns the text as-is if no JSON found
 */
function parseOutputData(entry: GeneratorEntry, outputSchema: Record<string, any>): Record<string, any> {
  // Try to parse JSON from entry_text
  // Format expected: "Some text {\"key\": \"value\"}"
  const jsonMatch = entry.entry_text.match(/\{.*\}/s);

  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch (e) {
      // If JSON parsing fails, fall back to creating simple object
      logger.warn('Failed to parse JSON from entry_text', {
        entry_id: entry.id,
        entry_key: entry.entry_key,
        error: String(e),
      });
    }
  }

  // Fallback: create simple object with entry_text as description
  // Try to match the first property in the schema
  const schemaProps = outputSchema.properties || {};
  const firstPropKey = Object.keys(schemaProps)[0] || 'result';

  return {
    [firstPropKey]: entry.entry_text,
  };
}

/**
 * Execute a generator roll
 * CRITICAL PERFORMANCE REQUIREMENT: Must complete in < 300ms (p95)
 * NO LLM CALLS - all data is pre-computed
 */
export async function executeRoll(
  db: ExtendedDatabase,
  userId: string,
  campaignId: string,
  generatorId: string,
  request: ExecuteRollRequest
): Promise<RollResult> {
  const startTime = Date.now();

  // Verify campaign ownership first
  await verifyCampaignOwnership(db, userId, campaignId);

  // Debug logging to see what we're receiving
  logger.debug('Roll request received', {
    test_mode: request.test_mode,
    session_id: request.session_id,
    scene_id: request.scene_id,
    has_session: !!request.session_id,
    will_skip_validation: request.test_mode || !request.session_id,
  });

  // Skip session validation in test mode OR if no session_id provided
  if (!request.test_mode && request.session_id) {
    // Verify session exists and belongs to campaign
    const session = await db.oneOrNone<{ campaign_id: string }>(
      'SELECT campaign_id FROM sessions WHERE id = $1',
      [request.session_id]
    );

    if (!session) {
      throw new NotFoundError('Session');
    }

    if (session.campaign_id !== campaignId) {
      throw new NotFoundError('Session');
    }

    // If scene_id provided, verify it belongs to session
    if (request.scene_id) {
      const scene = await db.oneOrNone<{ session_id: string }>(
        'SELECT session_id FROM session_scenes WHERE id = $1',
        [request.scene_id]
      );

      if (!scene || scene.session_id !== request.session_id) {
        throw new NotFoundError('Scene');
      }
    }
  }

  // Get generator with primary table and entries in a single efficient query
  const generator = await db.oneOrNone<{
    id: string;
    name: string;
    campaign_id: string;
    mode: string;
    output_schema: any;
    primary_table_id: string;
    status: string;
  }>(
    `SELECT id, name, campaign_id, mode, output_schema, primary_table_id, status
     FROM generators
     WHERE id = $1 AND campaign_id = $2`,
    [generatorId, campaignId]
  );

  if (!generator) {
    throw new NotFoundError('Generator');
  }

  if (generator.status !== 'active') {
    throw new ValidationError('Generator is not active');
  }

  if (generator.mode !== 'table') {
    throw new ValidationError('Only table mode generators support roll execution');
  }

  if (!generator.primary_table_id) {
    throw new ValidationError('Generator has no primary table');
  }

  // Get all entries for the primary table in one query
  const entries = await db.any<GeneratorEntry>(
    `SELECT * FROM generator_entries
     WHERE table_id = $1
     ORDER BY display_order ASC`,
    [generator.primary_table_id]
  );

  if (entries.length === 0) {
    throw new ValidationError('Generator table has no entries');
  }

  // Generate or use provided seed
  const seed = request.seed || generateSeed(generatorId, Date.now());

  // Create RNG from seed
  const rng = seedrandom(seed);

  // Perform weighted random selection
  const selectedEntry = weightedRandomSelect(entries, rng);

  // Parse output data from entry and inject entry_key for statistics tracking
  const rolledValue = {
    ...parseOutputData(selectedEntry, generator.output_schema),
    entry_key: selectedEntry.entry_key,
  };

  const rollTimestamp = new Date();
  const latency = Date.now() - startTime;

  // Log the roll to database (unless test mode)
  let rollId: string | undefined;

  if (!request.test_mode) {
    const roll = await db.one<GeneratorRoll>(
      `INSERT INTO generator_rolls (
        generator_id, session_id, rolled_value, random_seed,
        roll_timestamp, rolled_by_user_id
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *`,
      [
        generatorId,
        request.session_id,
        JSON.stringify(rolledValue),
        seed,
        rollTimestamp,
        userId,
      ]
    );
    rollId = roll.id;
  }

  logger.info('Generator roll executed', {
    generator_id: generatorId,
    generator_name: generator.name,
    roll_id: rollId,
    entry_key: selectedEntry.entry_key,
    latency_ms: latency,
    session_id: request.session_id,
    scene_id: request.scene_id,
    user_id: userId,
    test_mode: request.test_mode || false,
  });

  // Performance warning if > 300ms
  if (latency > 300) {
    logger.warn('Generator roll exceeded 300ms performance target', {
      generator_id: generatorId,
      latency_ms: latency,
    });
  }

  return {
    id: rollId,
    generator_id: generatorId,
    generator_name: generator.name,
    rolled_value: rolledValue,
    entry_key: selectedEntry.entry_key,
    entry_text: selectedEntry.entry_text,
    random_seed: seed,
    roll_timestamp: rollTimestamp,
    latency_ms: latency,
  };
}

/**
 * Get roll history for a generator
 * Supports filtering by session and scene
 */
export async function getRollHistory(
  db: ExtendedDatabase,
  userId: string,
  campaignId: string,
  generatorId: string,
  options: ListRollsOptions = {}
): Promise<PaginatedResponse<GeneratorRoll>> {
  // Verify campaign ownership first
  await verifyCampaignOwnership(db, userId, campaignId);

  // Verify generator exists and belongs to campaign
  const generator = await db.oneOrNone<{ campaign_id: string }>(
    'SELECT campaign_id FROM generators WHERE id = $1',
    [generatorId]
  );

  if (!generator) {
    throw new NotFoundError('Generator');
  }

  if (generator.campaign_id !== campaignId) {
    throw new NotFoundError('Generator');
  }

  const skip = Math.max(0, options.skip || 0);
  const limit = Math.min(100, Math.max(1, options.limit || 50));

  // Build WHERE clause
  let whereClause = 'generator_id = $1';
  const params: any[] = [generatorId];

  if (options.sessionId) {
    params.push(options.sessionId);
    whereClause += ` AND session_id = $${params.length}`;
  }

  if (options.sceneId) {
    params.push(options.sceneId);
    whereClause += ` AND scene_id = $${params.length}`;
  }

  // Get total count
  const totalResult = await db.one<{ count: string }>(
    `SELECT COUNT(*) FROM generator_rolls WHERE ${whereClause}`,
    params
  );
  const total = parseInt(totalResult.count, 10);

  // Get rolls
  const rolls = await db.any<GeneratorRoll>(
    `SELECT * FROM generator_rolls
     WHERE ${whereClause}
     ORDER BY roll_timestamp DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, skip]
  );

  logger.debug('Roll history retrieved', {
    generator_id: generatorId,
    campaign_id: campaignId,
    user_id: userId,
    count: rolls.length,
    total,
  });

  return {
    data: rolls,
    total,
    skip,
    limit,
  };
}

/**
 * Get roll statistics for a generator
 * Returns frequency distribution of entry keys
 */
export async function getRollStatistics(
  db: ExtendedDatabase,
  userId: string,
  campaignId: string,
  generatorId: string,
  sessionId?: string
): Promise<{
  total_rolls: number;
  entry_distribution: Array<{
    entry_key: string;
    count: number;
    percentage: number;
  }>;
}> {
  // Verify campaign ownership first
  await verifyCampaignOwnership(db, userId, campaignId);

  // Verify generator exists and belongs to campaign
  const generator = await db.oneOrNone<{ campaign_id: string }>(
    'SELECT campaign_id FROM generators WHERE id = $1',
    [generatorId]
  );

  if (!generator) {
    throw new NotFoundError('Generator');
  }

  if (generator.campaign_id !== campaignId) {
    throw new NotFoundError('Generator');
  }

  // Build WHERE clause
  let whereClause = 'generator_id = $1';
  const params: any[] = [generatorId];

  if (sessionId) {
    params.push(sessionId);
    whereClause += ` AND session_id = $${params.length}`;
  }

  // Get total rolls
  const totalResult = await db.one<{ count: string }>(
    `SELECT COUNT(*) FROM generator_rolls WHERE ${whereClause}`,
    params
  );
  const totalRolls = parseInt(totalResult.count, 10);

  // Get distribution by extracting entry_key from rolled_value JSONB
  // Note: This assumes rolled_value contains an 'entry_key' field
  // We'll need to parse this from the actual roll data
  const distribution = await db.any<{
    entry_key: string;
    count: string;
  }>(
    `SELECT
       rolled_value->>'entry_key' as entry_key,
       COUNT(*) as count
     FROM generator_rolls
     WHERE ${whereClause}
     GROUP BY rolled_value->>'entry_key'
     ORDER BY count DESC`,
    params
  );

  const entryDistribution = distribution.map(item => ({
    entry_key: item.entry_key || 'unknown',
    count: parseInt(item.count, 10),
    percentage: totalRolls > 0 ? (parseInt(item.count, 10) / totalRolls) * 100 : 0,
  }));

  logger.debug('Roll statistics retrieved', {
    generator_id: generatorId,
    campaign_id: campaignId,
    user_id: userId,
    total_rolls: totalRolls,
  });

  return {
    total_rolls: totalRolls,
    entry_distribution: entryDistribution,
  };
}
