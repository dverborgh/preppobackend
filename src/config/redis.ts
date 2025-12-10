/**
 * Redis connection configuration and caching utilities
 */

import { createClient, RedisClientType } from 'redis';
import { getRedisUrl } from './index';
import logger from '../utils/logger';

let redisClient: RedisClientType | null = null;

/**
 * Initialize Redis connection
 */
export async function initRedis(): Promise<RedisClientType> {
  if (redisClient) {
    return redisClient;
  }

  const redisUrl = getRedisUrl();

  try {
    redisClient = createClient({
      url: redisUrl,
    });

    // Error handler
    redisClient.on('error', (err) => {
      logger.error('Redis connection error:', err);
    });

    // Connect handler
    redisClient.on('connect', () => {
      logger.info('Redis connection established');
    });

    // Reconnect handler
    redisClient.on('reconnecting', () => {
      logger.warn('Redis reconnecting...');
    });

    await redisClient.connect();

    // Test connection
    await redisClient.ping();

    logger.info('Redis connection initialized successfully');

    return redisClient;
  } catch (error) {
    logger.error('Failed to initialize Redis:', error);
    throw error;
  }
}

/**
 * Get Redis client instance
 */
export function getRedis(): RedisClientType {
  if (!redisClient) {
    throw new Error('Redis not initialized. Call initRedis() first.');
  }
  return redisClient;
}

/**
 * Close Redis connection
 */
export async function closeRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    logger.info('Redis connection closed');
  }
}

/**
 * Cache helper functions
 */
export class CacheService {
  private client: RedisClientType;

  constructor(client: RedisClientType) {
    this.client = client;
  }

  /**
   * Get cached value
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      const value = await this.client.get(key);
      if (!value) return null;
      return JSON.parse(value) as T;
    } catch (error) {
      logger.error(`Cache get error for key ${key}:`, error);
      return null;
    }
  }

  /**
   * Set cached value with TTL
   */
  async set(key: string, value: any, ttlSeconds?: number): Promise<void> {
    try {
      const serialized = JSON.stringify(value);
      if (ttlSeconds) {
        await this.client.setEx(key, ttlSeconds, serialized);
      } else {
        await this.client.set(key, serialized);
      }
    } catch (error) {
      logger.error(`Cache set error for key ${key}:`, error);
    }
  }

  /**
   * Delete cached value
   */
  async del(key: string): Promise<void> {
    try {
      await this.client.del(key);
    } catch (error) {
      logger.error(`Cache delete error for key ${key}:`, error);
    }
  }

  /**
   * Check if key exists
   */
  async exists(key: string): Promise<boolean> {
    try {
      const result = await this.client.exists(key);
      return result === 1;
    } catch (error) {
      logger.error(`Cache exists error for key ${key}:`, error);
      return false;
    }
  }

  /**
   * Increment counter
   */
  async incr(key: string): Promise<number> {
    try {
      return await this.client.incr(key);
    } catch (error) {
      logger.error(`Cache incr error for key ${key}:`, error);
      return 0;
    }
  }

  /**
   * Set expiration on key
   */
  async expire(key: string, ttlSeconds: number): Promise<void> {
    try {
      await this.client.expire(key, ttlSeconds);
    } catch (error) {
      logger.error(`Cache expire error for key ${key}:`, error);
    }
  }

  /**
   * Get multiple keys
   */
  async mget<T>(keys: string[]): Promise<(T | null)[]> {
    try {
      const values = await this.client.mGet(keys);
      return values.map((v) => (v ? (JSON.parse(v) as T) : null));
    } catch (error) {
      logger.error(`Cache mget error:`, error);
      return keys.map(() => null);
    }
  }

  /**
   * Delete keys by pattern
   */
  async delByPattern(pattern: string): Promise<void> {
    try {
      const keys = [];
      for await (const key of this.client.scanIterator({ MATCH: pattern })) {
        keys.push(key);
      }
      if (keys.length > 0) {
        await this.client.del(keys);
      }
    } catch (error) {
      logger.error(`Cache delete by pattern error for pattern ${pattern}:`, error);
    }
  }

  /**
   * Add to JWT blacklist
   */
  async blacklistToken(token: string, expiresIn: number): Promise<void> {
    const key = `blacklist:${token}`;
    await this.set(key, true, expiresIn);
  }

  /**
   * Check if token is blacklisted
   */
  async isTokenBlacklisted(token: string): Promise<boolean> {
    const key = `blacklist:${token}`;
    return this.exists(key);
  }
}

/**
 * Get cache service instance
 */
export function getCacheService(): CacheService {
  return new CacheService(getRedis());
}

export default redisClient;
