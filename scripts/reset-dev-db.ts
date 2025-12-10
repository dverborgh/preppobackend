/**
 * Development Database Reset Script
 * Clears all user data and related records for local testing
 *
 * WARNING: This script is for DEVELOPMENT ONLY!
 * Never run this in production!
 *
 * Usage:
 *   npm run db:reset-dev
 */

import dotenv from 'dotenv';
import path from 'path';
import pgPromise from 'pg-promise';
import readline from 'readline';

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

/**
 * Ask for user confirmation before proceeding
 */
async function confirmAction(): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(
      '\n⚠️  WARNING: This will DELETE ALL USER DATA from the database!\n' +
        'This includes:\n' +
        '  - Users and auth tokens\n' +
        '  - Campaigns, sessions, and scenes\n' +
        '  - Generators and generator rolls\n' +
        '  - Resources and RAG data\n' +
        '  - Music scenes and tracks\n' +
        '\nAre you ABSOLUTELY SURE you want to continue? (yes/no): ',
      (answer) => {
        rl.close();
        resolve(answer.toLowerCase() === 'yes');
      }
    );
  });
}

/**
 * Reset the database by deleting all user data
 */
async function resetDatabase(): Promise<void> {
  console.log('\n🔄 Starting database reset...\n');

  try {
    // Delete data in reverse order of dependencies
    const tables = [
      // Music & Soundboard
      'tracks',
      'track_recipes',
      'music_scenes',
      'soundboard_sessions',

      // Generator system
      'generator_rolls',
      'generator_entries',
      'generator_tables',
      'generators',

      // RAG system
      'session_packet_chunks',
      'session_packets',
      'resource_chunks',
      'resources',

      // Session management
      'session_scene_generators',
      'session_scenes',
      'sessions',

      // Campaigns
      'campaigns',

      // Authentication
      'users',
    ];

    let totalDeleted = 0;

    for (const table of tables) {
      try {
        const result = await db.result(`DELETE FROM ${table}`);
        const deleted = result.rowCount;
        if (deleted > 0) {
          console.log(`  ✓ Deleted ${deleted} rows from ${table}`);
          totalDeleted += deleted;
        }
      } catch (error: any) {
        // Skip tables that don't exist (might be from future migrations)
        if (error.code === '42P01') {
          console.log(`  ⊘ Skipped ${table} (table does not exist)`);
        } else {
          throw error;
        }
      }
    }

    console.log(`\n✅ Database reset complete! Deleted ${totalDeleted} total rows.\n`);
    console.log('You can now register a new account.\n');
  } catch (error: any) {
    console.error('\n❌ Error resetting database:', error.message);
    throw error;
  } finally {
    await db.$pool.end();
  }
}

/**
 * Main execution
 */
async function main(): Promise<void> {
  // Check if we're in production
  if (process.env.NODE_ENV === 'production') {
    console.error(
      '\n❌ ERROR: This script cannot be run in production!\n' +
        'Set NODE_ENV=development to run this script.\n'
    );
    process.exit(1);
  }

  console.log('🗄️  Preppo Development Database Reset Tool');
  console.log('==========================================\n');

  // Confirm action
  const confirmed = await confirmAction();

  if (!confirmed) {
    console.log('\n❌ Reset cancelled by user.\n');
    process.exit(0);
  }

  // Perform reset
  await resetDatabase();

  console.log('Done! 🎉\n');
  process.exit(0);
}

// Run the script
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
