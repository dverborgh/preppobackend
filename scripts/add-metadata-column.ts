/**
 * Script to add metadata column to resource_chunks table
 * This fixes the issue where V004 migration was executed before the column was added
 */

import dotenv from 'dotenv';
import path from 'path';
import pgPromise from 'pg-promise';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env') });

const pgp = pgPromise();
const db = pgp({
  host: process.env.DATABASE_HOST || 'localhost',
  port: parseInt(process.env.DATABASE_PORT || '5432', 10),
  database: process.env.DATABASE_NAME || 'preppo_db',
  user: process.env.DATABASE_USER || 'preppo_user',
  password: process.env.DATABASE_PASSWORD || '',
});

async function addMetadataColumn(): Promise<void> {
  try {
    console.log('🔧 Adding metadata column to resource_chunks table...\n');

    // Add metadata column
    await db.none(`
      ALTER TABLE resource_chunks
      ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
    `);

    console.log('✅ Added metadata column');

    // Add comment
    await db.none(`
      COMMENT ON COLUMN resource_chunks.metadata IS 'Additional metadata for the chunk (JSON format)';
    `);

    console.log('✅ Added column comment');

    console.log('\n✨ Column added successfully!\n');
  } catch (error: any) {
    console.error('\n❌ Error adding column:', error.message);
    throw error;
  } finally {
    await db.$pool.end();
  }
}

addMetadataColumn().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
