/**
 * Integration tests for auth routes
 * Tests all authentication endpoints with mocked database
 */

import request from 'supertest';
import express, { Express } from 'express';
import authRoutes from '../../src/routes/auth';
import { errorHandler } from '../../src/middleware/errorHandler';
import * as database from '../../src/config/database';
import * as redis from '../../src/config/redis';
import * as authService from '../../src/services/authService';
import * as authUtils from '../../src/utils/auth';

// Mock dependencies
jest.mock('../../src/config/database');
jest.mock('../../src/config/redis');
jest.mock('../../src/services/authService');
jest.mock('../../src/utils/auth');
jest.mock('../../src/utils/logger', () => {
  const mockLogger = {
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    silent: true,
  };
  return {
    __esModule: true,
    default: mockLogger,
    logSecurityEvent: jest.fn(),
  };
});

describe('Auth Routes Integration Tests', () => {
  let app: Express;
  let mockDb: any;
  let mockCache: any;

  beforeAll(() => {
    // Create Express app
    app = express();
    app.use(express.json());
    app.use('/api/auth', authRoutes);
    app.use(errorHandler);
  });

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Mock database
    mockDb = {
      one: jest.fn(),
      oneOrNone: jest.fn(),
      none: jest.fn(),
      result: jest.fn(),
    };
    (database.getDatabase as jest.Mock).mockReturnValue(mockDb);

    // Mock cache service
    mockCache = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      exists: jest.fn(),
      blacklistToken: jest.fn(),
      isTokenBlacklisted: jest.fn().mockResolvedValue(false),
    };
    (redis.getCacheService as jest.Mock).mockReturnValue(mockCache);

    // Mock auth utils
    (authUtils.getTokenExpiresIn as jest.Mock).mockReturnValue(86400);
    (authUtils.extractTokenFromHeader as jest.Mock).mockReturnValue('mock_token');
    (authUtils.verifyAccessToken as jest.Mock).mockReturnValue({
      sub: 'user-123',
      email: 'test@example.com',
      iat: Date.now(),
      exp: Date.now() + 86400,
      iss: 'preppo.example.com',
    });
  });

  describe('POST /api/auth/register', () => {
    it('should register a new user successfully (201)', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        username: null,
        created_at: new Date(),
        last_login: null,
        preferences: {},
      };

      (authService.registerUser as jest.Mock).mockResolvedValue({
        user: mockUser,
        token: 'access_token_123',
        refreshToken: 'refresh_token_123',
      });

      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'test@example.com',
          password: 'SecurePassword123!',
          name: 'Test User',
        });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('user_id', 'user-123');
      expect(response.body).toHaveProperty('email', 'test@example.com');
      expect(response.body).toHaveProperty('token', 'access_token_123');
      expect(response.body).toHaveProperty('refreshToken', 'refresh_token_123');
      expect(response.body).toHaveProperty('expires_in', 86400);
    });

    it('should return 409 for duplicate email', async () => {
      (authService.registerUser as jest.Mock).mockRejectedValue(
        new (require('../../src/types').ConflictError)('Email already registered')
      );

      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'existing@example.com',
          password: 'SecurePassword123!',
        });

      expect(response.status).toBe(409);
      expect(response.body).toHaveProperty('error', 'Email already registered');
      expect(response.body).toHaveProperty('code', 'CONFLICT');
    });

    it('should return 400 for invalid email format', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'invalid-email',
          password: 'SecurePassword123!',
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('code', 'VALIDATION_ERROR');
    });

    it('should return 400 for weak password', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'test@example.com',
          password: 'weak',
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('code', 'VALIDATION_ERROR');
    });

    it('should not enforce rate limiting in test mode', async () => {
      // Make 6 requests (normally limit is 5 per hour, but disabled in test mode)
      const requests = [];
      for (let i = 0; i < 6; i++) {
        requests.push(
          request(app)
            .post('/api/auth/register')
            .send({
              email: `test${i}@example.com`,
              password: 'SecurePassword123!',
            })
        );
      }

      const responses = await Promise.all(requests);
      const rateLimited = responses.filter((r) => r.status === 429);

      // In test mode, rate limiting is disabled, so no requests should be rate limited
      expect(rateLimited.length).toBe(0);
    });
  });

  describe('POST /api/auth/login', () => {
    it('should login successfully (200)', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        username: null,
        created_at: new Date(),
        last_login: new Date(),
        preferences: {},
      };

      (authService.loginUser as jest.Mock).mockResolvedValue({
        user: mockUser,
        token: 'access_token_123',
        refreshToken: 'refresh_token_123',
      });

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'test@example.com',
          password: 'SecurePassword123!',
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('user_id', 'user-123');
      expect(response.body).toHaveProperty('token', 'access_token_123');
      expect(response.body).toHaveProperty('refreshToken', 'refresh_token_123');
    });

    it('should return 401 for wrong password', async () => {
      (authService.loginUser as jest.Mock).mockRejectedValue(
        new (require('../../src/types').UnauthorizedError)('Invalid email or password')
      );

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'test@example.com',
          password: 'WrongPassword123!',
        });

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error', 'Invalid email or password');
      expect(response.body).toHaveProperty('code', 'UNAUTHORIZED');
    });

    it('should not enforce rate limiting in test mode', async () => {
      // Make 6 requests (normally limit is 5 per minute, but disabled in test mode)
      const requests = [];
      for (let i = 0; i < 6; i++) {
        requests.push(
          request(app)
            .post('/api/auth/login')
            .send({
              email: 'test@example.com',
              password: 'SecurePassword123!',
            })
        );
      }

      const responses = await Promise.all(requests);
      const rateLimited = responses.filter((r) => r.status === 429);

      // In test mode, rate limiting is disabled, so no requests should be rate limited
      expect(rateLimited.length).toBe(0);
    });
  });

  describe('POST /api/auth/refresh', () => {
    it('should refresh token successfully (200)', async () => {
      (authService.refreshAccessToken as jest.Mock).mockResolvedValue({
        token: 'new_access_token',
        refreshToken: 'new_refresh_token',
      });

      const response = await request(app)
        .post('/api/auth/refresh')
        .send({
          refreshToken: 'valid_refresh_token',
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('token', 'new_access_token');
      expect(response.body).toHaveProperty('refreshToken', 'new_refresh_token');
      expect(response.body).toHaveProperty('expires_in', 86400);
    });

    it('should return 401 for invalid refresh token', async () => {
      (authService.refreshAccessToken as jest.Mock).mockRejectedValue(
        new (require('../../src/types').UnauthorizedError)('Invalid refresh token')
      );

      const response = await request(app)
        .post('/api/auth/refresh')
        .send({
          refreshToken: 'invalid_token',
        });

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error', 'Invalid refresh token');
    });

    it('should return 400 for missing refresh token', async () => {
      const response = await request(app).post('/api/auth/refresh').send({});

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('code', 'VALIDATION_ERROR');
    });
  });

  describe('GET /api/auth/me', () => {
    it('should return user profile successfully (200)', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        username: null,
        created_at: new Date(),
        last_login: new Date(),
        preferences: { theme: 'dark' },
      };

      (authService.getUserById as jest.Mock).mockResolvedValue(mockUser);

      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer valid_token');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('user_id', 'user-123');
      expect(response.body).toHaveProperty('email', 'test@example.com');
      expect(response.body).toHaveProperty('preferences');
    });

    it('should return 401 for missing token', async () => {
      (authUtils.extractTokenFromHeader as jest.Mock).mockImplementation(() => {
        throw new (require('../../src/types').UnauthorizedError)('No authorization header');
      });

      const response = await request(app).get('/api/auth/me');

      expect(response.status).toBe(401);
    });

    it('should return 401 for invalid token', async () => {
      (authUtils.verifyAccessToken as jest.Mock).mockImplementation(() => {
        throw new (require('../../src/types').UnauthorizedError)('Invalid token');
      });

      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer invalid_token');

      expect(response.status).toBe(401);
    });

    it('should return 401 for blacklisted token', async () => {
      mockCache.isTokenBlacklisted.mockResolvedValue(true);

      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer blacklisted_token');

      expect(response.status).toBe(401);
    });
  });

  describe('POST /api/auth/logout', () => {
    it('should logout successfully (200)', async () => {
      (authService.revokeRefreshToken as jest.Mock).mockResolvedValue(undefined);

      const response = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', 'Bearer valid_token')
        .send({
          refreshToken: 'valid_refresh_token',
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('message', 'Logged out successfully');
      expect(authService.revokeRefreshToken).toHaveBeenCalledWith(
        mockDb,
        'valid_refresh_token'
      );
      expect(mockCache.blacklistToken).toHaveBeenCalled();
    });

    it('should return 401 for missing authentication', async () => {
      (authUtils.extractTokenFromHeader as jest.Mock).mockImplementation(() => {
        throw new (require('../../src/types').UnauthorizedError)('No authorization header');
      });

      const response = await request(app)
        .post('/api/auth/logout')
        .send({
          refreshToken: 'valid_refresh_token',
        });

      expect(response.status).toBe(401);
    });

    it('should return 400 for missing refresh token', async () => {
      const response = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', 'Bearer valid_token')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('code', 'VALIDATION_ERROR');
    });
  });
});
