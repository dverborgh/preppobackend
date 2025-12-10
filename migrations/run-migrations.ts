/**
 * Migration runner script
 * Executes SQL migrations in order
 */

import { initDatabase, closeDatabase } from '../src/config/database';
import logger from '../src/utils/logger';
import fs from 'fs';
import path from 'path';

interface Migration {
  version: string;
  filename: string;
  sql: string;
}

async function runMigrations(): Promise<void> {
  try {
    logger.info('Starting migrations...');

    // Initialize database
    const db = await initDatabase();

    // Create migrations tracking table if it doesn't exist
    await db.none(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(20) PRIMARY KEY,
        filename VARCHAR(255) NOT NULL,
        executed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Get already executed migrations
    const executed = await db.manyOrNone<{ version: string }>(
      'SELECT version FROM schema_migrations ORDER BY version'
    );
    const executedVersions = new Set(executed.map((m) => m.version));

    // Read migration files
    const migrationsDir = __dirname;
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    const migrations: Migration[] = files.map((filename) => {
      const version = filename.split('__')[0];
      const sql = fs.readFileSync(path.join(migrationsDir, filename), 'utf-8');
      return { version, filename, sql };
    });

    // Execute pending migrations
    for (const migration of migrations) {
      if (executedVersions.has(migration.version)) {
        logger.info(`Skipping already executed migration: ${migration.filename}`);
        continue;
      }

      logger.info(`Executing migration: ${migration.filename}`);

      await db.tx(async (tx) => {
        // Execute migration SQL
        await tx.none(migration.sql);

        // Record migration
        await tx.none(
          'INSERT INTO schema_migrations (version, filename) VALUES ($1, $2)',
          [migration.version, migration.filename]
        );
      });

      logger.info(`Completed migration: ${migration.filename}`);
    }

    logger.info('All migrations completed successfully');
  } catch (error) {
    logger.error('Migration failed:', error);
    throw error;
  } finally {
    await closeDatabase();
  }
}

// Run if executed directly
if (require.main === module) {
  runMigrations()
    .then(() => {
      console.log('Migrations completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration error:', error);
      process.exit(1);
    });
}

export default runMigrations;
