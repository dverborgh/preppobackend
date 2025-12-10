/**
 * Database connection configuration and initialization
 * Uses pg-promise for PostgreSQL with pgvector support
 */

import pgPromise, { IDatabase, IMain } from 'pg-promise';
import { getDatabaseUrl } from './index';
import logger from '../utils/logger';

// pg-promise initialization options
const initOptions: pgPromise.IInitOptions = {
  // Log all queries in development
  query(e) {
    if (process.env.NODE_ENV === 'development') {
      logger.debug(`SQL: ${e.query}`);
    }
  },

  // Log errors
  error(err, e) {
    if (e.cn) {
      // Connection error
      logger.error('Database connection error:', err);
    } else if (e.query) {
      // Query error
      logger.error('Database query error:', {
        error: err.message,
        query: e.query,
        params: e.params,
      });
    }
  },

  // Extend database protocol with custom methods
  extend(obj: any) {
    // Add support for pgvector operations
    obj.vectorDistance = function (
      vector1: number[],
      vector2: number[],
      metric: 'cosine' | 'l2' | 'inner_product' = 'cosine'
    ): string {
      const operators = {
        cosine: '<=>',
        l2: '<->',
        inner_product: '<#>',
      };
      return `'[${vector1.join(',')}]'::vector ${operators[metric]} '[${vector2.join(',')}]'::vector`;
    };
  },
};

// Create pg-promise instance
const pgp: IMain = pgPromise(initOptions);

// Database interface
export interface IExtensions {
  vectorDistance(
    vector1: number[],
    vector2: number[],
    metric?: 'cosine' | 'l2' | 'inner_product'
  ): string;
}

export type ExtendedDatabase = IDatabase<IExtensions> & IExtensions;

// Create database instance
let db: ExtendedDatabase | null = null;

/**
 * Initialize database connection
 */
export async function initDatabase(): Promise<ExtendedDatabase> {
  if (db) {
    return db;
  }

  const connectionString = getDatabaseUrl();

  try {
    db = pgp<IExtensions>(connectionString) as ExtendedDatabase;

    // Test connection
    await db.one('SELECT NOW() as current_time');

    // Ensure pgvector extension is enabled
    await db.none('CREATE EXTENSION IF NOT EXISTS vector');

    logger.info('Database connection established successfully');

    return db;
  } catch (error) {
    logger.error('Failed to initialize database:', error);
    throw error;
  }
}

/**
 * Get database instance (must call initDatabase first)
 */
export function getDatabase(): ExtendedDatabase {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

/**
 * Close database connection
 */
export async function closeDatabase(): Promise<void> {
  if (db) {
    await db.$pool.end();
    db = null;
    logger.info('Database connection closed');
  }
}

/**
 * Execute a transaction
 */
export async function transaction<T>(
  callback: (tx: ExtendedDatabase) => Promise<T>
): Promise<T> {
  const database = getDatabase();
  return database.tx(async (tx) => {
    // Type assertion is safe here as tx has all required database methods
    return callback(tx as unknown as ExtendedDatabase);
  });
}

/**
 * Helper to convert array to PostgreSQL array literal
 */
export function toPgArray(arr: any[]): string {
  return `{${arr.map((item) => (typeof item === 'string' ? `"${item}"` : item)).join(',')}}`;
}

/**
 * Helper to convert vector array to pgvector format
 */
export function toVector(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

/**
 * Helper to parse PostgreSQL array
 */
export function fromPgArray(pgArray: string | null): any[] {
  if (!pgArray) return [];
  // Remove curly braces and split
  return pgArray
    .slice(1, -1)
    .split(',')
    .map((item) => {
      // Remove quotes if present
      const trimmed = item.trim();
      if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
        return trimmed.slice(1, -1);
      }
      // Try to parse as number
      const num = parseFloat(trimmed);
      return isNaN(num) ? trimmed : num;
    });
}

export { pgp };
export default db;
