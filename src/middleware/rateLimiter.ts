/**
 * Rate limiting middleware
 * Uses Redis to track request counts
 */

import { Request, Response, NextFunction } from 'express';
import { getCacheService } from '../config/redis';
import config from '../config';
import logger from '../utils/logger';

interface RateLimitOptions {
  windowMs: number;
  maxRequests: number;
  keyGenerator?: (req: Request) => string;
  skipSuccessfulRequests?: boolean;
}

/**
 * Create rate limiter middleware
 */
export function createRateLimiter(options: RateLimitOptions) {
  const { windowMs, maxRequests, keyGenerator, skipSuccessfulRequests = false } = options;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Skip rate limiting in development and test modes
    if (config.server.nodeEnv === 'development' || config.server.nodeEnv === 'test') {
      next();
      return;
    }

    try {
      const cache = getCacheService();

      // Generate key for this request
      const key = keyGenerator
        ? keyGenerator(req)
        : `ratelimit:${req.ip}:${req.path}`;

      // Get current count
      const currentCount = await cache.incr(key);

      // Set expiration on first request
      if (currentCount === 1) {
        await cache.expire(key, Math.ceil(windowMs / 1000));
      }

      // Check if limit exceeded
      if (currentCount > maxRequests) {
        logger.warn('Rate limit exceeded', {
          key,
          count: currentCount,
          limit: maxRequests,
        });

        res.status(429).json({
          error: 'Too many requests',
          code: 'RATE_LIMITED',
          retryAfter: Math.ceil(windowMs / 1000),
        });
        return;
      }

      // Add rate limit headers
      res.setHeader('X-RateLimit-Limit', maxRequests);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - currentCount));
      res.setHeader('X-RateLimit-Reset', Date.now() + windowMs);

      // If skip successful requests, decrement on success
      if (skipSuccessfulRequests) {
        const originalSend = res.send;
        res.send = function (data: any): Response {
          if (res.statusCode < 400) {
            cache.incr(key).then((count) => {
              if (count > 0) {
                cache.incr(key); // Decrement by incrementing negative
              }
            });
          }
          return originalSend.call(this, data);
        };
      }

      next();
    } catch (error) {
      logger.error('Rate limiter error:', error);
      // Don't block requests if rate limiter fails
      next();
    }
  };
}

/**
 * Auth rate limiter (5 requests per minute per IP)
 */
export const authRateLimiter = createRateLimiter({
  windowMs: config.rateLimit.auth.windowMs,
  maxRequests: config.rateLimit.auth.maxRequests,
  keyGenerator: (req) => `ratelimit:auth:${req.ip}`,
});

/**
 * Generator roll rate limiter (100 requests per minute per user)
 */
export const generatorRollRateLimiter = createRateLimiter({
  windowMs: config.rateLimit.generatorRolls.windowMs,
  maxRequests: config.rateLimit.generatorRolls.maxRequests,
  keyGenerator: (req) => `ratelimit:rolls:${req.user?.id || req.ip}`,
});

/**
 * RAG query rate limiter (20 requests per minute per user)
 */
export const ragQueryRateLimiter = createRateLimiter({
  windowMs: config.rateLimit.ragQueries.windowMs,
  maxRequests: config.rateLimit.ragQueries.maxRequests,
  keyGenerator: (req) => `ratelimit:rag:${req.user?.id || req.ip}`,
});

/**
 * File upload rate limiter (10 requests per hour per user)
 */
export const uploadRateLimiter = createRateLimiter({
  windowMs: config.rateLimit.uploads.windowMs,
  maxRequests: config.rateLimit.uploads.maxRequests,
  keyGenerator: (req) => `ratelimit:upload:${req.user?.id || req.ip}`,
});

/**
 * General API rate limiter
 */
export const apiRateLimiter = createRateLimiter({
  windowMs: config.rateLimit.windowMs,
  maxRequests: config.rateLimit.maxRequests,
  keyGenerator: (req) => `ratelimit:api:${req.user?.id || req.ip}`,
  skipSuccessfulRequests: true,
});
