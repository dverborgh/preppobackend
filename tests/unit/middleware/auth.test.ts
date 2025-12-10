/**
 * Unit tests for authentication middleware
 * Tests JWT token validation, blacklist checking, and user extraction
 */

import { Request, Response, NextFunction } from 'express';
import { authenticate, optionalAuthenticate, requireAuth } from '../../../src/middleware/auth';
import * as authUtils from '../../../src/utils/auth';
import * as redis from '../../../src/config/redis';
import { UnauthorizedError } from '../../../src/types';

// Mock dependencies
jest.mock('../../../src/utils/auth');
jest.mock('../../../src/config/redis');
jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
}));

describe('Auth Middleware', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;
  let mockCache: any;

  const userId = '123e4567-e89b-12d3-a456-426614174000';
  const userEmail = 'test@example.com';
  const validToken = 'valid_jwt_token';

  beforeEach(() => {
    jest.clearAllMocks();

    mockRequest = {
      headers: {
        authorization: `Bearer ${validToken}`,
      },
      user: undefined,
    };

    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    mockNext = jest.fn();

    // Mock cache service
    mockCache = {
      isTokenBlacklisted: jest.fn().mockResolvedValue(false),
    };
    (redis.getCacheService as jest.Mock).mockReturnValue(mockCache);

    // Mock auth utils - default to success
    (authUtils.extractTokenFromHeader as jest.Mock).mockReturnValue(validToken);
    (authUtils.verifyAccessToken as jest.Mock).mockReturnValue({
      sub: userId,
      email: userEmail,
      iat: Date.now(),
      exp: Date.now() + 86400000,
      iss: 'preppo.example.com',
    });
  });

  describe('authenticate middleware', () => {
    it('should attach user to request with valid token', async () => {
      await authenticate(mockRequest as Request, mockResponse as Response, mockNext);

      expect(authUtils.extractTokenFromHeader).toHaveBeenCalledWith(`Bearer ${validToken}`);
      expect(authUtils.verifyAccessToken).toHaveBeenCalledWith(validToken);
      expect(mockCache.isTokenBlacklisted).toHaveBeenCalledWith(validToken);
      expect(mockRequest.user).toEqual({
        id: userId,
        email: userEmail,
      });
      expect(mockNext).toHaveBeenCalledWith();
      expect(mockResponse.status).not.toHaveBeenCalled();
    });

    it('should return 401 when authorization header is missing', async () => {
      (authUtils.extractTokenFromHeader as jest.Mock).mockImplementation(() => {
        throw new UnauthorizedError('No authorization header');
      });

      await authenticate(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'No authorization header',
        code: 'UNAUTHORIZED',
      });
      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRequest.user).toBeUndefined();
    });

    it('should return 401 when token is blacklisted', async () => {
      mockCache.isTokenBlacklisted.mockResolvedValue(true);

      await authenticate(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockCache.isTokenBlacklisted).toHaveBeenCalledWith(validToken);
      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Token has been revoked',
        code: 'UNAUTHORIZED',
      });
      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRequest.user).toBeUndefined();
    });

    it('should return 401 when token is expired', async () => {
      (authUtils.verifyAccessToken as jest.Mock).mockImplementation(() => {
        throw new UnauthorizedError('Token expired');
      });

      await authenticate(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Token expired',
        code: 'UNAUTHORIZED',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 401 when token is invalid', async () => {
      (authUtils.verifyAccessToken as jest.Mock).mockImplementation(() => {
        throw new UnauthorizedError('Invalid token');
      });

      await authenticate(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Invalid token',
        code: 'UNAUTHORIZED',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 401 when authorization header format is invalid', async () => {
      (authUtils.extractTokenFromHeader as jest.Mock).mockImplementation(() => {
        throw new UnauthorizedError('Invalid authorization header format');
      });

      await authenticate(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Invalid authorization header format',
        code: 'UNAUTHORIZED',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should handle non-UnauthorizedError exceptions gracefully', async () => {
      (authUtils.verifyAccessToken as jest.Mock).mockImplementation(() => {
        throw new Error('Unexpected error');
      });

      await authenticate(mockRequest as Request, mockResponse as Response, mockNext);

      // Logger should be called (mocked in beforeEach)
      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Authentication failed',
        code: 'UNAUTHORIZED',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should correctly extract user ID and email from token payload', async () => {
      const customPayload = {
        sub: '999e4567-e89b-12d3-a456-426614174999',
        email: 'custom@example.com',
        iat: Date.now(),
        exp: Date.now() + 86400000,
        iss: 'preppo.example.com',
      };
      (authUtils.verifyAccessToken as jest.Mock).mockReturnValue(customPayload);

      await authenticate(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockRequest.user).toEqual({
        id: customPayload.sub,
        email: customPayload.email,
      });
      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should verify token is not blacklisted before validating payload', async () => {
      const calls: string[] = [];

      mockCache.isTokenBlacklisted.mockImplementation(async () => {
        calls.push('blacklist-check');
        return false;
      });

      (authUtils.verifyAccessToken as jest.Mock).mockImplementation(() => {
        calls.push('token-verify');
        return {
          sub: userId,
          email: userEmail,
          iat: Date.now(),
          exp: Date.now() + 86400000,
          iss: 'preppo.example.com',
        };
      });

      await authenticate(mockRequest as Request, mockResponse as Response, mockNext);

      // Blacklist check should happen before token verification
      expect(calls).toEqual(['blacklist-check', 'token-verify']);
    });
  });

  describe('optionalAuthenticate middleware', () => {
    it('should attach user when valid token is provided', async () => {
      await optionalAuthenticate(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockRequest.user).toEqual({
        id: userId,
        email: userEmail,
      });
      expect(mockNext).toHaveBeenCalledWith();
      expect(mockResponse.status).not.toHaveBeenCalled();
    });

    it('should continue without user when no authorization header', async () => {
      mockRequest.headers = {};

      await optionalAuthenticate(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockRequest.user).toBeUndefined();
      expect(mockNext).toHaveBeenCalledWith();
      expect(authUtils.extractTokenFromHeader).not.toHaveBeenCalled();
      expect(authUtils.verifyAccessToken).not.toHaveBeenCalled();
    });

    it('should continue without user when token is invalid', async () => {
      (authUtils.verifyAccessToken as jest.Mock).mockImplementation(() => {
        throw new UnauthorizedError('Invalid token');
      });

      await optionalAuthenticate(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockRequest.user).toBeUndefined();
      expect(mockNext).toHaveBeenCalledWith();
      expect(mockResponse.status).not.toHaveBeenCalled();
    });

    it('should continue without user when token is blacklisted', async () => {
      mockCache.isTokenBlacklisted.mockResolvedValue(true);

      await optionalAuthenticate(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockRequest.user).toBeUndefined();
      expect(mockNext).toHaveBeenCalledWith();
      expect(mockResponse.status).not.toHaveBeenCalled();
    });

    it('should ignore extraction errors and continue', async () => {
      (authUtils.extractTokenFromHeader as jest.Mock).mockImplementation(() => {
        throw new Error('Extraction failed');
      });

      await optionalAuthenticate(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockRequest.user).toBeUndefined();
      expect(mockNext).toHaveBeenCalledWith();
      expect(mockResponse.status).not.toHaveBeenCalled();
    });

    it('should not attach user when token is expired', async () => {
      (authUtils.verifyAccessToken as jest.Mock).mockImplementation(() => {
        throw new UnauthorizedError('Token expired');
      });

      await optionalAuthenticate(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockRequest.user).toBeUndefined();
      expect(mockNext).toHaveBeenCalledWith();
    });
  });

  describe('requireAuth helper', () => {
    it('should return user when authenticated', () => {
      mockRequest.user = {
        id: userId,
        email: userEmail,
      };

      const user = requireAuth(mockRequest as Request);

      expect(user).toEqual({
        id: userId,
        email: userEmail,
      });
    });

    it('should throw UnauthorizedError when user is not set', () => {
      mockRequest.user = undefined;

      expect(() => requireAuth(mockRequest as Request)).toThrow(UnauthorizedError);
      expect(() => requireAuth(mockRequest as Request)).toThrow('Authentication required');
    });

    it('should throw when user is null', () => {
      mockRequest.user = undefined;

      expect(() => requireAuth(mockRequest as Request)).toThrow(UnauthorizedError);
    });

    it('should return correct user data structure', () => {
      const customUser = {
        id: '999e4567-e89b-12d3-a456-426614174999',
        email: 'custom@example.com',
      };
      mockRequest.user = customUser;

      const user = requireAuth(mockRequest as Request);

      expect(user).toEqual(customUser);
      expect(user.id).toBe(customUser.id);
      expect(user.email).toBe(customUser.email);
    });
  });

  describe('Integration scenarios', () => {
    it('should handle full authentication flow correctly', async () => {
      const authHeader = 'Bearer my_secure_token_12345';
      mockRequest.headers = { authorization: authHeader };

      (authUtils.extractTokenFromHeader as jest.Mock).mockReturnValue('my_secure_token_12345');
      (authUtils.verifyAccessToken as jest.Mock).mockReturnValue({
        sub: userId,
        email: userEmail,
        iat: 1234567890,
        exp: 1234567890 + 86400,
        iss: 'preppo.example.com',
      });
      mockCache.isTokenBlacklisted.mockResolvedValue(false);

      await authenticate(mockRequest as Request, mockResponse as Response, mockNext);

      expect(authUtils.extractTokenFromHeader).toHaveBeenCalledWith(authHeader);
      expect(authUtils.verifyAccessToken).toHaveBeenCalledWith('my_secure_token_12345');
      expect(mockCache.isTokenBlacklisted).toHaveBeenCalledWith('my_secure_token_12345');
      expect(mockRequest.user).toBeDefined();
      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should handle logout scenario with blacklisted token', async () => {
      mockCache.isTokenBlacklisted.mockResolvedValue(true);

      await authenticate(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Token has been revoked',
        })
      );
      expect(authUtils.verifyAccessToken).not.toHaveBeenCalled();
    });

    it('should not call next() on any authentication failure', async () => {
      const failures = [
        () => {
          (authUtils.extractTokenFromHeader as jest.Mock).mockImplementation(() => {
            throw new UnauthorizedError('No authorization header');
          });
        },
        () => {
          mockCache.isTokenBlacklisted.mockResolvedValue(true);
        },
        () => {
          (authUtils.verifyAccessToken as jest.Mock).mockImplementation(() => {
            throw new UnauthorizedError('Token expired');
          });
        },
      ];

      for (const setupFailure of failures) {
        jest.clearAllMocks();
        setupFailure();

        await authenticate(mockRequest as Request, mockResponse as Response, mockNext);

        expect(mockNext).not.toHaveBeenCalled();
        expect(mockResponse.status).toHaveBeenCalledWith(401);
      }
    });
  });
});
