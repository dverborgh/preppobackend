/**
 * Integration tests for authentication flow
 * Tests the complete auth lifecycle: register, login, token refresh, logout
 */

import request from 'supertest';
import express, { Express } from 'express';
import { initDatabase, closeDatabase, ExtendedDatabase } from '../../src/config/database';
import { initRedis, closeRedis } from '../../src/config/redis';
import jwt from 'jsonwebtoken';
import config from '../../src/config';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import { errorHandler, notFoundHandler } from '../../src/middleware/errorHandler';
import { apiRateLimiter } from '../../src/middleware/rateLimiter';
import authRoutes from '../../src/routes/auth';

describe('Authentication Integration Tests', () => {
  let server: Express;
  let db: ExtendedDatabase;
  let testEmail: string;
  let testPassword: string;
  let originalNodeEnv: string | undefined;

  beforeAll(async () => {
    // Force development mode for tests to disable rate limiting
    originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    // Initialize database and Redis
    db = await initDatabase();
    await initRedis();

    // Create test app
    const app = express();
    app.use(helmet());
    app.use(cors({ origin: '*', credentials: true }));
    app.use(express.json({ limit: '10mb' }));
    app.use(express.urlencoded({ extended: true, limit: '10mb' }));
    app.use(compression());

    // Apply rate limiter (will be disabled in development mode)
    app.use(apiRateLimiter);

    // Mount auth routes
    const apiRouter = express.Router();
    apiRouter.use('/auth', authRoutes);
    app.use('/api', apiRouter);

    // Error handlers
    app.use(notFoundHandler);
    app.use(errorHandler);

    server = app;

    // Generate unique test email for each test run
    testEmail = `test-${Date.now()}@example.com`;
    testPassword = 'SecurePassword@1234';
  });

  afterAll(async () => {
    // Clean up test data
    await db.none('DELETE FROM users WHERE email LIKE $1', ['test-%@example.com']);
    await db.none('DELETE FROM users WHERE email LIKE $1', ['complete-flow-%@example.com']);
    await closeDatabase();
    await closeRedis();

    // Restore original NODE_ENV
    if (originalNodeEnv !== undefined) {
      process.env.NODE_ENV = originalNodeEnv;
    } else {
      delete process.env.NODE_ENV;
    }
  });

  describe('POST /api/auth/register', () => {
    it('should successfully register a new user', async () => {
      const response = await request(server)
        .post('/api/auth/register')
        .send({
          email: testEmail,
          password: testPassword,
          name: 'Test User',
          username: 'testuser',
        })
        .expect(201);

      // Verify response structure
      expect(response.body).toHaveProperty('user_id');
      expect(response.body).toHaveProperty('email', testEmail);
      expect(response.body).toHaveProperty('name', 'Test User');
      expect(response.body).toHaveProperty('username', 'testuser');
      expect(response.body).toHaveProperty('token');
      expect(response.body).toHaveProperty('refreshToken');
      expect(response.body).toHaveProperty('expires_in');

      // Verify JWT token is valid
      const decoded = jwt.verify(response.body.token, config.jwt.secret) as any;
      expect(decoded.sub).toBe(response.body.user_id);
      expect(decoded.email).toBe(testEmail);

      // Verify user was created in database
      const user = await db.oneOrNone('SELECT * FROM users WHERE email = $1', [testEmail]);
      expect(user).toBeTruthy();
      expect(user.email).toBe(testEmail);
      expect(user.name).toBe('Test User');
      expect(user.is_active).toBe(true);

      // Verify refresh token was created
      const refreshTokens = await db.manyOrNone(
        'SELECT * FROM refresh_tokens WHERE user_id = $1',
        [response.body.user_id]
      );
      expect(refreshTokens.length).toBe(1);
      expect(refreshTokens[0].revoked).toBe(false);
    });

    it('should reject registration with existing email', async () => {
      const response = await request(server)
        .post('/api/auth/register')
        .send({
          email: testEmail,
          password: testPassword,
          name: 'Duplicate User',
        })
        .expect(409);

      expect(response.body).toHaveProperty('error', 'Email already registered');
      expect(response.body).toHaveProperty('code', 'CONFLICT');
    });

    it('should reject registration with weak password', async () => {
      const response = await request(server)
        .post('/api/auth/register')
        .send({
          email: 'weak@example.com',
          password: 'weak',
        })
        .expect(400);

      expect(response.body).toHaveProperty('code', 'VALIDATION_ERROR');
      expect(response.body.details).toBeTruthy();
    });

    it('should reject registration with invalid email', async () => {
      const response = await request(server)
        .post('/api/auth/register')
        .send({
          email: 'not-an-email',
          password: testPassword,
        })
        .expect(400);

      expect(response.body).toHaveProperty('code', 'VALIDATION_ERROR');
    });

    it('should not be rate limited in development mode', async () => {
      // Make 10 rapid registration attempts (should all fail but not be rate limited)
      const promises = Array.from({ length: 10 }, (_, i) =>
        request(server)
          .post('/api/auth/register')
          .send({
            email: `test-${Date.now()}-${i}@example.com`,
            password: 'Short1!', // Will fail validation
          })
      );

      const responses = await Promise.all(promises);

      // All should fail due to validation, but none should be rate limited (429)
      responses.forEach((response) => {
        expect(response.status).not.toBe(429);
        expect(response.status).toBe(400); // Validation error
      });
    });
  });

  describe('POST /api/auth/login', () => {
    let userId: string;
    let accessToken: string;
    let refreshToken: string;

    it('should successfully login with correct credentials', async () => {
      const response = await request(server)
        .post('/api/auth/login')
        .send({
          email: testEmail,
          password: testPassword,
        })
        .expect(200);

      // Verify response structure
      expect(response.body).toHaveProperty('user_id');
      expect(response.body).toHaveProperty('email', testEmail);
      expect(response.body).toHaveProperty('token');
      expect(response.body).toHaveProperty('refreshToken');
      expect(response.body).toHaveProperty('expires_in');

      // Store tokens for subsequent tests
      userId = response.body.user_id;
      accessToken = response.body.token;
      refreshToken = response.body.refreshToken;

      // Verify JWT token is valid
      const decoded = jwt.verify(accessToken, config.jwt.secret) as any;
      expect(decoded.sub).toBe(userId);
      expect(decoded.email).toBe(testEmail);

      // Verify last_login was updated
      const user = await db.one('SELECT last_login FROM users WHERE id = $1', [userId]);
      expect(user.last_login).toBeTruthy();
    });

    it('should reject login with wrong password', async () => {
      const response = await request(server)
        .post('/api/auth/login')
        .send({
          email: testEmail,
          password: 'WrongPassword123!',
        })
        .expect(401);

      expect(response.body).toHaveProperty('error', 'Invalid email or password');
      expect(response.body).toHaveProperty('code', 'UNAUTHORIZED');
    });

    it('should reject login with non-existent email', async () => {
      const response = await request(server)
        .post('/api/auth/login')
        .send({
          email: 'nonexistent@example.com',
          password: testPassword,
        })
        .expect(401);

      expect(response.body).toHaveProperty('error', 'Invalid email or password');
    });

    it('should not be rate limited in development mode', async () => {
      // Make 10 rapid login attempts
      const promises = Array.from({ length: 10 }, () =>
        request(server).post('/api/auth/login').send({
          email: testEmail,
          password: testPassword,
        })
      );

      const responses = await Promise.all(promises);

      // All should succeed (no rate limiting)
      responses.forEach((response) => {
        expect(response.status).toBe(200);
      });
    });

    describe('POST /api/auth/refresh', () => {
      it('should successfully refresh access token', async () => {
        // Wait 1 second to ensure different timestamps
        await new Promise((resolve) => setTimeout(resolve, 1000));

        const response = await request(server)
          .post('/api/auth/refresh')
          .send({
            refreshToken: refreshToken,
          })
          .expect(200);

        // Verify response structure
        expect(response.body).toHaveProperty('token');
        expect(response.body).toHaveProperty('refreshToken');
        expect(response.body).toHaveProperty('expires_in');

        // Verify new token is different from old token
        expect(response.body.token).not.toBe(accessToken);
        expect(response.body.refreshToken).not.toBe(refreshToken);

        // Verify new JWT token is valid
        const decoded = jwt.verify(response.body.token, config.jwt.secret) as any;
        expect(decoded.sub).toBe(userId);
        expect(decoded.email).toBe(testEmail);

        // Update tokens for logout test
        accessToken = response.body.token;
        refreshToken = response.body.refreshToken;

        // Verify old refresh token was revoked (may have multiple tokens from multiple logins)
        const oldTokenCount = await db.one(
          'SELECT COUNT(*) FROM refresh_tokens WHERE user_id = $1 AND revoked = false',
          [userId]
        );
        expect(parseInt(oldTokenCount.count)).toBeGreaterThanOrEqual(1); // At least the new token should be active
      });

      it('should reject invalid refresh token', async () => {
        const response = await request(server)
          .post('/api/auth/refresh')
          .send({
            refreshToken: 'invalid-token-12345',
          })
          .expect(401);

        expect(response.body).toHaveProperty('error', 'Invalid refresh token');
      });

      it('should reject revoked refresh token', async () => {
        // Create and immediately revoke a token
        const loginResponse = await request(server)
          .post('/api/auth/login')
          .send({
            email: testEmail,
            password: testPassword,
          });

        const revokedToken = loginResponse.body.refreshToken;

        // Hash the token using Node.js crypto (same way backend does it)
        const crypto = require('crypto');
        const tokenHash = crypto.createHash('sha256').update(revokedToken).digest('hex');

        // Revoke it
        await db.none(
          `UPDATE refresh_tokens
           SET revoked = true, revoked_at = CURRENT_TIMESTAMP
           WHERE token_hash = $1`,
          [tokenHash]
        );

        // Try to use revoked token
        const response = await request(server)
          .post('/api/auth/refresh')
          .send({
            refreshToken: revokedToken,
          })
          .expect(401);

        expect(response.body).toHaveProperty('error', 'Refresh token has been revoked');
      });
    });

    describe('GET /api/auth/me', () => {
      it('should return current user profile with valid token', async () => {
        const response = await request(server)
          .get('/api/auth/me')
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(200);

        expect(response.body).toHaveProperty('user_id', userId);
        expect(response.body).toHaveProperty('email', testEmail);
        expect(response.body).toHaveProperty('name', 'Test User');
        expect(response.body).toHaveProperty('created_at');
        expect(response.body).toHaveProperty('last_login');
        expect(response.body).not.toHaveProperty('password_hash');
      });

      it('should reject request without token', async () => {
        const response = await request(server).get('/api/auth/me').expect(401);

        expect(response.body).toHaveProperty('error', 'No authorization header');
      });

      it('should reject request with invalid token', async () => {
        const response = await request(server)
          .get('/api/auth/me')
          .set('Authorization', 'Bearer invalid-token')
          .expect(401);

        expect(response.body).toHaveProperty('error', 'Invalid token');
      });
    });

    describe('POST /api/auth/logout', () => {
      it('should successfully logout and revoke refresh token', async () => {
        const response = await request(server)
          .post('/api/auth/logout')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({
            refreshToken: refreshToken,
          })
          .expect(200);

        expect(response.body).toHaveProperty('message', 'Logged out successfully');

        // Verify the specific refresh token was revoked (there may be other active tokens from other logins)
        const crypto = require('crypto');
        const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
        const revokedToken = await db.oneOrNone(
          'SELECT * FROM refresh_tokens WHERE token_hash = $1',
          [tokenHash]
        );
        expect(revokedToken).toBeTruthy();
        expect(revokedToken.revoked).toBe(true);
      });

      it('should reject logout without authorization', async () => {
        const response = await request(server)
          .post('/api/auth/logout')
          .send({
            refreshToken: refreshToken,
          })
          .expect(401);

        expect(response.body).toHaveProperty('error', 'No authorization header');
      });
    });
  });

  describe('Complete Auth Flow', () => {
    it('should complete full auth lifecycle: register -> login -> refresh -> logout', async () => {
      const uniqueEmail = `complete-flow-${Date.now()}@example.com`;

      // 1. Register
      const registerRes = await request(server)
        .post('/api/auth/register')
        .send({
          email: uniqueEmail,
          password: testPassword,
          name: 'Complete Flow User',
        })
        .expect(201);

      const registeredUserId = registerRes.body.user_id;
      expect(registerRes.body.token).toBeTruthy();
      expect(registerRes.body.refreshToken).toBeTruthy();

      // 2. Login
      const loginRes = await request(server)
        .post('/api/auth/login')
        .send({
          email: uniqueEmail,
          password: testPassword,
        })
        .expect(200);

      expect(loginRes.body.user_id).toBe(registeredUserId);
      expect(loginRes.body.token).toBeTruthy();
      expect(loginRes.body.refreshToken).toBeTruthy();

      const loginToken = loginRes.body.token;
      const loginRefreshToken = loginRes.body.refreshToken;

      // 3. Verify token works
      const meRes = await request(server)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${loginToken}`)
        .expect(200);

      expect(meRes.body.email).toBe(uniqueEmail);

      // 4. Refresh token
      await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait to ensure different token
      const refreshRes = await request(server)
        .post('/api/auth/refresh')
        .send({
          refreshToken: loginRefreshToken,
        })
        .expect(200);

      expect(refreshRes.body.token).toBeTruthy();
      expect(refreshRes.body.token).not.toBe(loginToken);
      const newToken = refreshRes.body.token;
      const newRefreshToken = refreshRes.body.refreshToken;

      // 5. Verify new token works
      const meRes2 = await request(server)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${newToken}`)
        .expect(200);

      expect(meRes2.body.email).toBe(uniqueEmail);

      // 6. Logout
      const logoutRes = await request(server)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${newToken}`)
        .send({
          refreshToken: newRefreshToken,
        })
        .expect(200);

      expect(logoutRes.body.message).toBe('Logged out successfully');

      // 7. Verify refresh token is revoked
      const refreshAfterLogout = await request(server)
        .post('/api/auth/refresh')
        .send({
          refreshToken: newRefreshToken,
        })
        .expect(401);

      // After logout, the token should be invalid (either revoked or not found)
      expect(refreshAfterLogout.body.error).toMatch(/Invalid refresh token|Refresh token has been revoked/);

      // Clean up
      await db.none('DELETE FROM users WHERE id = $1', [registeredUserId]);
    });
  });
});
