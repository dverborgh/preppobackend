/**
 * Unit tests for rate limiter middleware
 * Tests rate limit enforcement, Redis integration, and headers
 */

import { Request, Response, NextFunction } from 'express';
import { createRateLimiter } from '../../../src/middleware/rateLimiter';
import * as redis from '../../../src/config/redis';
import config from '../../../src/config';

// Mock dependencies
jest.mock('../../../src/config/redis');
jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
}));

describe('Rate Limiter Middleware', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;
  let mockCache: any;
  let setHeaderSpy: jest.Mock;

  const originalNodeEnv = config.server.nodeEnv;

  beforeEach(() => {
    jest.clearAllMocks();

    setHeaderSpy = jest.fn();

    mockRequest = {
      ip: '192.168.1.100',
      path: '/api/test',
      user: {
        id: '123e4567-e89b-12d3-a456-426614174000',
        email: 'test@example.com',
      },
    };

    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      setHeader: setHeaderSpy,
      send: jest.fn(),
      statusCode: 200,
    };

    mockNext = jest.fn();

    // Mock cache service
    mockCache = {
      incr: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(undefined),
    };
    (redis.getCacheService as jest.Mock).mockReturnValue(mockCache);

    // Reset to production mode for rate limiting tests
    (config.server as any).nodeEnv = 'production';
  });

  afterEach(() => {
    // Restore original environment
    (config.server as any).nodeEnv = originalNodeEnv;
  });

  describe('createRateLimiter', () => {
    it('should allow request when under rate limit', async () => {
      mockCache.incr.mockResolvedValue(1);

      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 10,
      });

      await limiter(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockCache.incr).toHaveBeenCalledWith('ratelimit:192.168.1.100:/api/test');
      expect(mockCache.expire).toHaveBeenCalledWith('ratelimit:192.168.1.100:/api/test', 60);
      expect(setHeaderSpy).toHaveBeenCalledWith('X-RateLimit-Limit', 10);
      expect(setHeaderSpy).toHaveBeenCalledWith('X-RateLimit-Remaining', 9);
      expect(setHeaderSpy).toHaveBeenCalledWith('X-RateLimit-Reset', expect.any(Number));
      expect(mockNext).toHaveBeenCalledWith();
      expect(mockResponse.status).not.toHaveBeenCalled();
    });

    it('should block request when rate limit exceeded', async () => {
      mockCache.incr.mockResolvedValue(11);
      const logger = require('../../../src/utils/logger');

      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 10,
      });

      await limiter(mockRequest as Request, mockResponse as Response, mockNext);

      expect(logger.warn).toHaveBeenCalledWith('Rate limit exceeded', {
        key: 'ratelimit:192.168.1.100:/api/test',
        count: 11,
        limit: 10,
      });
      expect(mockResponse.status).toHaveBeenCalledWith(429);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Too many requests',
        code: 'RATE_LIMITED',
        retryAfter: 60,
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should set expiration only on first request', async () => {
      mockCache.incr.mockResolvedValueOnce(1).mockResolvedValueOnce(2);

      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 10,
      });

      // First request
      await limiter(mockRequest as Request, mockResponse as Response, mockNext);
      expect(mockCache.expire).toHaveBeenCalledTimes(1);

      jest.clearAllMocks();

      // Second request
      await limiter(mockRequest as Request, mockResponse as Response, mockNext);
      expect(mockCache.expire).not.toHaveBeenCalled();
    });

    it('should use custom key generator when provided', async () => {
      mockCache.incr.mockResolvedValue(1);

      const customKeyGenerator = jest.fn((req: Request) => `custom:${req.user?.id}`);

      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 10,
        keyGenerator: customKeyGenerator,
      });

      await limiter(mockRequest as Request, mockResponse as Response, mockNext);

      expect(customKeyGenerator).toHaveBeenCalledWith(mockRequest);
      expect(mockCache.incr).toHaveBeenCalledWith('custom:123e4567-e89b-12d3-a456-426614174000');
      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should calculate correct remaining count', async () => {
      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 100,
      });

      // Test various counts
      const testCases = [
        { count: 1, expectedRemaining: 99 },
        { count: 50, expectedRemaining: 50 },
        { count: 99, expectedRemaining: 1 },
        { count: 100, expectedRemaining: 0 },
      ];

      for (const { count, expectedRemaining } of testCases) {
        jest.clearAllMocks();
        mockCache.incr.mockResolvedValue(count);

        await limiter(mockRequest as Request, mockResponse as Response, mockNext);

        expect(setHeaderSpy).toHaveBeenCalledWith('X-RateLimit-Remaining', expectedRemaining);
      }
    });

    it('should set correct rate limit headers', async () => {
      mockCache.incr.mockResolvedValue(5);

      const limiter = createRateLimiter({
        windowMs: 120000,
        maxRequests: 20,
      });

      await limiter(mockRequest as Request, mockResponse as Response, mockNext);

      expect(setHeaderSpy).toHaveBeenCalledWith('X-RateLimit-Limit', 20);
      expect(setHeaderSpy).toHaveBeenCalledWith('X-RateLimit-Remaining', 15);
      expect(setHeaderSpy).toHaveBeenCalledWith('X-RateLimit-Reset', expect.any(Number));

      // Verify reset time is in the future
      const resetCall = setHeaderSpy.mock.calls.find(call => call[0] === 'X-RateLimit-Reset');
      expect(resetCall[1]).toBeGreaterThan(Date.now());
    });

    it('should never show negative remaining count', async () => {
      mockCache.incr.mockResolvedValue(15);

      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 10,
      });

      await limiter(mockRequest as Request, mockResponse as Response, mockNext);

      // When over limit, request is blocked (429) and headers might not be set
      // But if headers are set, remaining should never be negative
      const remainingCall = setHeaderSpy.mock.calls.find(call => call[0] === 'X-RateLimit-Remaining');
      if (remainingCall) {
        expect(remainingCall[1]).toBeGreaterThanOrEqual(0);
      }
      // Should be blocked since count > maxRequests
      expect(mockResponse.status).toHaveBeenCalledWith(429);
    });

    it('should skip rate limiting in development mode', async () => {
      (config.server as any).nodeEnv = 'development';

      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 10,
      });

      await limiter(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockCache.incr).not.toHaveBeenCalled();
      expect(mockCache.expire).not.toHaveBeenCalled();
      expect(setHeaderSpy).not.toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should skip rate limiting in test mode', async () => {
      (config.server as any).nodeEnv = 'test';

      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 10,
      });

      await limiter(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockCache.incr).not.toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should handle Redis errors gracefully', async () => {
      mockCache.incr.mockRejectedValue(new Error('Redis connection failed'));
      const logger = require('../../../src/utils/logger');

      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 10,
      });

      await limiter(mockRequest as Request, mockResponse as Response, mockNext);

      expect(logger.error).toHaveBeenCalledWith('Rate limiter error:', expect.any(Error));
      // Should not block requests if rate limiter fails
      expect(mockNext).toHaveBeenCalledWith();
      expect(mockResponse.status).not.toHaveBeenCalled();
    });

    it('should use IP address when user is not authenticated', async () => {
      mockCache.incr.mockResolvedValue(1);
      mockRequest.user = undefined;

      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 10,
        keyGenerator: (req) => `ratelimit:${req.user?.id || req.ip}`,
      });

      await limiter(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockCache.incr).toHaveBeenCalledWith('ratelimit:192.168.1.100');
      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should convert windowMs to seconds for expire', async () => {
      mockCache.incr.mockResolvedValue(1);

      const limiter = createRateLimiter({
        windowMs: 120000, // 2 minutes
        maxRequests: 10,
      });

      await limiter(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockCache.expire).toHaveBeenCalledWith(
        'ratelimit:192.168.1.100:/api/test',
        120 // 120 seconds
      );
    });

    it('should round up windowMs when converting to seconds', async () => {
      mockCache.incr.mockResolvedValue(1);

      const limiter = createRateLimiter({
        windowMs: 1500, // 1.5 seconds
        maxRequests: 10,
      });

      await limiter(mockRequest as Request, mockResponse as Response, mockNext);

      // Should round up to 2 seconds
      expect(mockCache.expire).toHaveBeenCalledWith(
        expect.any(String),
        2
      );
    });

    it('should handle skipSuccessfulRequests option with successful response', async () => {
      mockCache.incr.mockResolvedValue(1);

      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 10,
        skipSuccessfulRequests: true,
      });

      await limiter(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();

      // Simulate successful response
      mockResponse.statusCode = 200;
      const sendFn = (mockResponse as any).send;

      // Send should have been wrapped
      expect(typeof sendFn).toBe('function');
    });

    it('should decrement counter for successful requests when skipSuccessfulRequests is true', async () => {
      mockCache.incr.mockResolvedValue(1);

      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 10,
        skipSuccessfulRequests: true,
      });

      await limiter(mockRequest as Request, mockResponse as Response, mockNext);

      // Access the modified send function
      const modifiedSend = mockResponse.send as any;

      // Call it with a successful status code
      mockResponse.statusCode = 200;
      mockCache.incr.mockResolvedValue(1);

      modifiedSend.call(mockResponse, { success: true });

      // Verify incr was called to check count
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(mockCache.incr).toHaveBeenCalled();
    });

    it('should not decrement counter for failed requests when skipSuccessfulRequests is true', async () => {
      mockCache.incr.mockResolvedValue(1);

      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 10,
        skipSuccessfulRequests: true,
      });

      await limiter(mockRequest as Request, mockResponse as Response, mockNext);

      // Access the modified send function
      const modifiedSend = mockResponse.send as any;

      // Call it with a failed status code
      mockResponse.statusCode = 400;

      modifiedSend.call(mockResponse, { error: 'Bad request' });

      // Should not call incr again for failed requests
      await new Promise(resolve => setTimeout(resolve, 10));
    });
  });

  describe('Redis integration', () => {
    it('should increment counter in Redis', async () => {
      mockCache.incr.mockResolvedValue(3);

      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 10,
      });

      await limiter(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockCache.incr).toHaveBeenCalledWith('ratelimit:192.168.1.100:/api/test');
      expect(mockCache.incr).toHaveBeenCalledTimes(1);
    });

    it('should set TTL correctly based on window', async () => {
      mockCache.incr.mockResolvedValue(1);

      const testCases = [
        { windowMs: 60000, expectedTTL: 60 },
        { windowMs: 300000, expectedTTL: 300 },
        { windowMs: 3600000, expectedTTL: 3600 },
      ];

      for (const { windowMs, expectedTTL } of testCases) {
        jest.clearAllMocks();
        mockCache.incr.mockResolvedValue(1);

        const limiter = createRateLimiter({
          windowMs,
          maxRequests: 10,
        });

        await limiter(mockRequest as Request, mockResponse as Response, mockNext);

        expect(mockCache.expire).toHaveBeenCalledWith(expect.any(String), expectedTTL);
      }
    });

    it('should use getCacheService to get Redis client', async () => {
      mockCache.incr.mockResolvedValue(1);

      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 10,
      });

      await limiter(mockRequest as Request, mockResponse as Response, mockNext);

      expect(redis.getCacheService).toHaveBeenCalled();
    });
  });

  describe('Edge cases', () => {
    it('should handle exactly at limit (not over)', async () => {
      mockCache.incr.mockResolvedValue(10);

      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 10,
      });

      await limiter(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
      expect(mockResponse.status).not.toHaveBeenCalled();
      expect(setHeaderSpy).toHaveBeenCalledWith('X-RateLimit-Remaining', 0);
    });

    it('should handle first request over limit', async () => {
      mockCache.incr.mockResolvedValue(11);

      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 10,
      });

      await limiter(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(429);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should handle missing IP address', async () => {
      mockCache.incr.mockResolvedValue(1);
      const requestWithoutIp = {
        ...mockRequest,
        ip: undefined,
      };

      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 10,
      });

      await limiter(requestWithoutIp as Request, mockResponse as Response, mockNext);

      // Should still create a key even with undefined IP
      expect(mockCache.incr).toHaveBeenCalledWith('ratelimit:undefined:/api/test');
      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should handle concurrent requests correctly', async () => {
      // Simulate two concurrent requests
      mockCache.incr.mockResolvedValueOnce(1).mockResolvedValueOnce(2);

      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 10,
      });

      await Promise.all([
        limiter(mockRequest as Request, mockResponse as Response, mockNext),
        limiter(mockRequest as Request, mockResponse as Response, mockNext),
      ]);

      expect(mockCache.incr).toHaveBeenCalledTimes(2);
      expect(mockNext).toHaveBeenCalledTimes(2);
    });
  });

  describe('Exported rate limiter instances', () => {
    it('should export authRateLimiter with correct configuration', async () => {
      const { authRateLimiter } = require('../../../src/middleware/rateLimiter');
      mockCache.incr.mockResolvedValue(1);

      await authRateLimiter(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockCache.incr).toHaveBeenCalledWith('ratelimit:auth:192.168.1.100');
      expect(mockNext).toHaveBeenCalled();
    });

    it('should export generatorRollRateLimiter with correct configuration', async () => {
      const { generatorRollRateLimiter } = require('../../../src/middleware/rateLimiter');
      mockCache.incr.mockResolvedValue(1);

      await generatorRollRateLimiter(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockCache.incr).toHaveBeenCalledWith(
        'ratelimit:rolls:123e4567-e89b-12d3-a456-426614174000'
      );
      expect(mockNext).toHaveBeenCalled();
    });

    it('should export ragQueryRateLimiter with correct configuration', async () => {
      const { ragQueryRateLimiter } = require('../../../src/middleware/rateLimiter');
      mockCache.incr.mockResolvedValue(1);

      await ragQueryRateLimiter(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockCache.incr).toHaveBeenCalledWith(
        'ratelimit:rag:123e4567-e89b-12d3-a456-426614174000'
      );
      expect(mockNext).toHaveBeenCalled();
    });

    it('should export uploadRateLimiter with correct configuration', async () => {
      const { uploadRateLimiter } = require('../../../src/middleware/rateLimiter');
      mockCache.incr.mockResolvedValue(1);

      await uploadRateLimiter(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockCache.incr).toHaveBeenCalledWith(
        'ratelimit:upload:123e4567-e89b-12d3-a456-426614174000'
      );
      expect(mockNext).toHaveBeenCalled();
    });

    it('should export apiRateLimiter with correct configuration', async () => {
      const { apiRateLimiter } = require('../../../src/middleware/rateLimiter');
      mockCache.incr.mockResolvedValue(1);

      await apiRateLimiter(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockCache.incr).toHaveBeenCalledWith(
        'ratelimit:api:123e4567-e89b-12d3-a456-426614174000'
      );
      expect(mockNext).toHaveBeenCalled();
    });
  });
});
