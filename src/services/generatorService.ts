/**
 * Generator service
 * Handles generator CRUD operations with authorization and validation
 */

import { ExtendedDatabase } from '../config/database';
import {
  NotFoundError,
  ValidationError,
  PaginatedResponse,
  Generator,
  GeneratorTable,
  GeneratorEntry,
} from '../types';
import logger from '../utils/logger';
import { verifyCampaignOwnership } from './campaignService';

// Generator data types
export interface CreateGeneratorData {
  name: string;
  description: string;
  mode: 'table' | 'llm';
  output_schema: Record<string, any>;
  output_example?: Record<string, any>;
  created_by_prompt?: string;
  tables?: CreateGeneratorTableData[];
}

export interface CreateGeneratorTableData {
  name: string;
  description?: string;
  roll_method?: 'weighted_random' | 'sequential' | 'range_based';
  entries: CreateGeneratorEntryData[];
}

export interface CreateGeneratorEntryData {
  entry_key: string;
  entry_text: string;
  weight?: number;
  roll_min?: number;
  roll_max?: number;
  display_order?: number;
}

export interface UpdateGeneratorData {
  name?: string;
  description?: string;
  output_schema?: Record<string, any>;
  output_example?: Record<string, any>;
  status?: 'active' | 'archived' | 'testing';
}

export interface GeneratorWithTables extends Generator {
  tables: GeneratorTableWithEntries[];
}

export interface GeneratorTableWithEntries extends GeneratorTable {
  entries: GeneratorEntry[];
}

export interface ListGeneratorsOptions {
  status?: 'active' | 'archived' | 'testing';
  skip?: number;
  limit?: number;
}

/**
 * Validate JSON schema for output_schema
 */
function validateOutputSchema(schema: any): void {
  if (!schema || typeof schema !== 'object') {
    throw new ValidationError('Output schema must be a valid object');
  }

  if (schema.type !== 'object') {
    throw new ValidationError('Output schema root type must be "object"');
  }

  if (!schema.properties || typeof schema.properties !== 'object') {
    throw new ValidationError('Output schema must have properties');
  }

  // Check max depth (prevent overly complex schemas)
  // Allows root (0) + up to 5 nested levels = max depth 5
  function checkDepth(obj: any, depth = 0): void {
    if (depth > 5) {
      throw new ValidationError('Output schema nesting exceeds maximum depth of 5 (root is depth 0)');
    }
    if (obj && typeof obj === 'object') {
      if (obj.properties) {
        Object.values(obj.properties).forEach(prop => checkDepth(prop, depth + 1));
      }
      if (obj.items) {
        checkDepth(obj.items, depth + 1);
      }
    }
  }

  checkDepth(schema);

  // Check max properties
  const countProperties = (obj: any): number => {
    let count = 0;
    if (obj && typeof obj === 'object') {
      if (obj.properties) {
        count += Object.keys(obj.properties).length;
        Object.values(obj.properties).forEach(prop => {
          count += countProperties(prop);
        });
      }
      if (obj.items) {
        count += countProperties(obj.items);
      }
    }
    return count;
  };

  const totalProps = countProperties(schema);
  if (totalProps > 50) {
    throw new ValidationError('Output schema has too many properties (max 50)');
  }
}

/**
 * Validate generator entries
 */
function validateGeneratorEntries(entries: CreateGeneratorEntryData[]): void {
  if (!entries || entries.length === 0) {
    throw new ValidationError('Generator table must have at least one entry');
  }

  if (entries.length > 100) {
    throw new ValidationError('Generator table cannot have more than 100 entries');
  }

  const seenKeys = new Set<string>();

  for (const entry of entries) {
    // Validate entry_key uniqueness
    if (seenKeys.has(entry.entry_key)) {
      throw new ValidationError(`Duplicate entry key: ${entry.entry_key}`);
    }
    seenKeys.add(entry.entry_key);

    // Validate entry_key format
    if (!entry.entry_key || entry.entry_key.trim().length === 0) {
      throw new ValidationError('Entry key cannot be empty');
    }

    if (entry.entry_key.length > 255) {
      throw new ValidationError('Entry key must not exceed 255 characters');
    }

    // Validate entry_text
    if (!entry.entry_text || entry.entry_text.trim().length === 0) {
      throw new ValidationError('Entry text cannot be empty');
    }

    // Validate weight
    const weight = entry.weight ?? 1;
    if (!Number.isInteger(weight) || weight < 1 || weight > 1000) {
      throw new ValidationError(`Entry weight must be an integer between 1 and 1000: ${entry.entry_key}`);
    }

    // Validate roll range if provided
    if (entry.roll_min !== undefined || entry.roll_max !== undefined) {
      if (entry.roll_min === undefined || entry.roll_max === undefined) {
        throw new ValidationError('Both roll_min and roll_max must be provided together');
      }
      if (!Number.isInteger(entry.roll_min) || !Number.isInteger(entry.roll_max)) {
        throw new ValidationError('Roll min and max must be integers');
      }
      if (entry.roll_min > entry.roll_max) {
        throw new ValidationError('Roll min must be less than or equal to roll max');
      }
    }
  }
}

/**
 * Create a new generator with tables and entries
 * For table mode, creates primary table with entries in a transaction
 */
export async function createGenerator(
  db: ExtendedDatabase,
  userId: string,
  campaignId: string,
  sessionId: string|undefined,
  data: CreateGeneratorData
): Promise<GeneratorWithTables> {
  // Verify campaign ownership first
  await verifyCampaignOwnership(db, userId, campaignId);

  // Validate inputs
  if (!data.name || data.name.trim().length === 0) {
    throw new ValidationError('Generator name is required');
  }

  if (data.name.trim().length > 255) {
    throw new ValidationError('Generator name must not exceed 255 characters');
  }

  if (!data.description || data.description.trim().length === 0) {
    throw new ValidationError('Generator description is required');
  }

  if (!['table', 'llm'].includes(data.mode)) {
    throw new ValidationError('Generator mode must be either "table" or "llm"');
  }

  // Validate output schema
  validateOutputSchema(data.output_schema);

  // For table mode, validate that tables are provided
  if (data.mode === 'table') {
    if (!data.tables || data.tables.length === 0) {
      throw new ValidationError('Table mode generator must have at least one table');
    }

    // Validate each table
    for (const table of data.tables) {
      if (!table.name || table.name.trim().length === 0) {
        throw new ValidationError('Table name is required');
      }
      if (table.name.trim().length > 255) {
        throw new ValidationError('Table name must not exceed 255 characters');
      }
      validateGeneratorEntries(table.entries);
    }
  }

  // Create generator and tables in a transaction
  const generator = await db.tx(async (t) => {
    // Step 1: Create generator without primary_table_id
    const newGenerator = await t.one<Generator>(
      `INSERT INTO generators (
        campaign_id, session_id, name, description, mode, output_schema,
        output_example, created_by_prompt, status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active')
      RETURNING *`,
      [
        campaignId,
        sessionId,
        data.name.trim(),
        data.description.trim(),
        data.mode,
        JSON.stringify(data.output_schema),
        data.output_example ? JSON.stringify(data.output_example) : null,
        data.created_by_prompt || null,
      ]
    );

    let tables: GeneratorTableWithEntries[] = [];

    // Step 2: For table mode, create tables and entries
    if (data.mode === 'table' && data.tables && data.tables.length > 0) {
      const primaryTableData = data.tables[0];

      // Create primary table
      const primaryTable = await t.one<GeneratorTable>(
        `INSERT INTO generator_tables (
          generator_id, name, description, roll_method
        )
        VALUES ($1, $2, $3, $4)
        RETURNING *`,
        [
          newGenerator.id,
          primaryTableData.name.trim(),
          primaryTableData.description?.trim() || null,
          primaryTableData.roll_method || 'weighted_random',
        ]
      );

      // Create entries for primary table
      const entries: GeneratorEntry[] = [];
      for (const entryData of primaryTableData.entries) {
        const entry = await t.one<GeneratorEntry>(
          `INSERT INTO generator_entries (
            table_id, entry_key, entry_text, weight, roll_min, roll_max, display_order
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING *`,
          [
            primaryTable.id,
            entryData.entry_key,
            entryData.entry_text,
            entryData.weight ?? 1,
            entryData.roll_min || null,
            entryData.roll_max || null,
            entryData.display_order ?? 0,
          ]
        );
        entries.push(entry);
      }

      tables.push({
        ...primaryTable,
        entries,
      });

      // Step 3: Update generator with primary_table_id
      await t.none(
        'UPDATE generators SET primary_table_id = $1 WHERE id = $2',
        [primaryTable.id, newGenerator.id]
      );

      newGenerator.primary_table_id = primaryTable.id;
    }

    logger.info('Generator created', {
      generator_id: newGenerator.id,
      campaign_id: campaignId,
      user_id: userId,
      name: newGenerator.name,
      mode: newGenerator.mode,
      table_count: tables.length,
      entry_count: tables.reduce((sum, t) => sum + t.entries.length, 0),
    });

    return {
      ...newGenerator,
      tables,
    };
  });

  return generator;
}

/**
 * Get generator by ID with full table structure
 * Verifies campaign ownership before returning data
 */
export async function getGenerator(
  db: ExtendedDatabase,
  userId: string,
  campaignId: string,
  generatorId: string
): Promise<GeneratorWithTables> {
  // Verify campaign ownership first
  await verifyCampaignOwnership(db, userId, campaignId);

  // Get generator
  const generator = await db.oneOrNone<Generator>(
    'SELECT * FROM generators WHERE id = $1 AND campaign_id = $2',
    [generatorId, campaignId]
  );

  if (!generator) {
    throw new NotFoundError('Generator');
  }

  // Get tables with entries
  const tables = await db.any<GeneratorTable>(
    `SELECT * FROM generator_tables
     WHERE generator_id = $1
     ORDER BY created_at ASC`,
    [generatorId]
  );

  const tablesWithEntries: GeneratorTableWithEntries[] = await Promise.all(
    tables.map(async (table) => {
      const entries = await db.any<GeneratorEntry>(
        `SELECT * FROM generator_entries
         WHERE table_id = $1
         ORDER BY display_order ASC, created_at ASC`,
        [table.id]
      );
      return {
        ...table,
        entries,
      };
    })
  );

  logger.debug('Generator retrieved', {
    generator_id: generatorId,
    campaign_id: campaignId,
    user_id: userId,
  });

  return {
    ...generator,
    tables: tablesWithEntries,
  };
}

/**
 * List generators for a campaign with optional filtering and pagination
 */
export async function listGenerators(
  db: ExtendedDatabase,
  userId: string,
  campaignId: string,
  options: ListGeneratorsOptions = {}
): Promise<PaginatedResponse<Generator>> {
  // Verify campaign ownership first
  await verifyCampaignOwnership(db, userId, campaignId);

  const skip = Math.max(0, options.skip || 0);
  const limit = Math.min(100, Math.max(1, options.limit || 50));

  // Validate status filter if provided
  if (options.status) {
    const validStatuses = ['active', 'archived', 'testing'];
    if (!validStatuses.includes(options.status)) {
      throw new ValidationError(
        `Invalid status filter. Must be one of: ${validStatuses.join(', ')}`
      );
    }
  }

  // Build WHERE clause
  let whereClause = 'campaign_id = $1';
  const params: any[] = [campaignId];

  if (options.status) {
    params.push(options.status);
    whereClause += ` AND status = $${params.length}`;
  }

  // Get total count
  const totalResult = await db.one<{ count: string }>(
    `SELECT COUNT(*) FROM generators WHERE ${whereClause}`,
    params
  );
  const total = parseInt(totalResult.count, 10);

  // Get generators
  const generators = await db.any<Generator>(
    `SELECT * FROM generators
     WHERE ${whereClause}
     ORDER BY created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, skip]
  );

  logger.debug('Generators listed', {
    campaign_id: campaignId,
    user_id: userId,
    count: generators.length,
    total,
    status_filter: options.status,
  });

  return {
    data: generators,
    total,
    skip,
    limit,
  };
}

/**
 * Update generator metadata
 * Only allows updating name, description, output_schema, output_example, and status
 * Does not modify tables or entries
 */
export async function updateGenerator(
  db: ExtendedDatabase,
  userId: string,
  campaignId: string,
  generatorId: string,
  data: UpdateGeneratorData
): Promise<Generator> {
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

  // Validate fields
  if (data.name !== undefined) {
    if (!data.name || data.name.trim().length === 0) {
      throw new ValidationError('Generator name cannot be empty');
    }
    if (data.name.trim().length > 255) {
      throw new ValidationError('Generator name must not exceed 255 characters');
    }
  }

  if (data.output_schema !== undefined) {
    validateOutputSchema(data.output_schema);
  }

  if (data.status !== undefined) {
    const validStatuses = ['active', 'archived', 'testing'];
    if (!validStatuses.includes(data.status)) {
      throw new ValidationError(
        `Invalid status. Must be one of: ${validStatuses.join(', ')}`
      );
    }
  }

  // Build dynamic update query
  const updates: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;

  if (data.name !== undefined) {
    updates.push(`name = $${paramIndex++}`);
    values.push(data.name.trim());
  }

  if (data.description !== undefined) {
    updates.push(`description = $${paramIndex++}`);
    values.push(data.description.trim());
  }

  if (data.output_schema !== undefined) {
    updates.push(`output_schema = $${paramIndex++}`);
    values.push(JSON.stringify(data.output_schema));
  }

  if (data.output_example !== undefined) {
    updates.push(`output_example = $${paramIndex++}`);
    values.push(data.output_example ? JSON.stringify(data.output_example) : null);
  }

  if (data.status !== undefined) {
    updates.push(`status = $${paramIndex++}`);
    values.push(data.status);
  }

  // If no updates, return current generator
  if (updates.length === 0) {
    return db.one<Generator>(
      'SELECT * FROM generators WHERE id = $1',
      [generatorId]
    );
  }

  // Add updated_at
  updates.push(`updated_at = CURRENT_TIMESTAMP`);

  // Add generator_id and campaign_id to values
  values.push(generatorId);
  values.push(campaignId);

  const updated = await db.one<Generator>(
    `UPDATE generators
     SET ${updates.join(', ')}
     WHERE id = $${paramIndex++} AND campaign_id = $${paramIndex}
     RETURNING *`,
    values
  );

  logger.info('Generator updated', {
    generator_id: generatorId,
    campaign_id: campaignId,
    user_id: userId,
    updates: Object.keys(data),
  });

  return updated;
}

/**
 * Delete generator
 * Verifies ownership and cascade deletes all related data (tables, entries, rolls)
 */
export async function deleteGenerator(
  db: ExtendedDatabase,
  userId: string,
  campaignId: string,
  generatorId: string
): Promise<void> {
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

  const result = await db.result(
    'DELETE FROM generators WHERE id = $1',
    [generatorId]
  );

  if (result.rowCount === 0) {
    throw new NotFoundError('Generator');
  }

  logger.info('Generator deleted', {
    generator_id: generatorId,
    campaign_id: campaignId,
    user_id: userId,
  });
}
