/**
 * Unit tests for authService
 * Tests user registration, login, token management
 */

import {
  registerUser,
  loginUser,
  getUserById,
  createRefreshToken,
  refreshAccessToken,
  revokeRefreshToken,
  cleanupExpiredTokens,
} from '../../src/services/authService';
import { ConflictError, UnauthorizedError, ValidationError } from '../../src/types';
import * as authUtils from '../../src/utils/auth';

// Mock dependencies
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

describe('AuthService', () => {
  // Mock database
  let mockDb: any;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Create mock database with pg-promise methods
    mockDb = {
      one: jest.fn(),
      oneOrNone: jest.fn(),
      none: jest.fn(),
      result: jest.fn(),
    };

    // Setup default mock implementations
    (authUtils.validateEmail as jest.Mock).mockReturnValue(true);
    (authUtils.validatePasswordStrength as jest.Mock).mockReturnValue({
      valid: true,
      errors: [],
    });
    (authUtils.hashPassword as jest.Mock).mockResolvedValue('hashed_password');
    (authUtils.comparePassword as jest.Mock).mockResolvedValue(true);
    (authUtils.generateAccessToken as jest.Mock).mockReturnValue('access_token_123');
    (authUtils.generateRefreshToken as jest.Mock).mockReturnValue('refresh_token_123');
  });

  describe('registerUser', () => {
    it('should successfully register a new user', async () => {
      // Mock database responses
      mockDb.oneOrNone.mockResolvedValue(null); // No existing user
      mockDb.one.mockResolvedValue({
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        username: null,
        created_at: new Date(),
        last_login: null,
        preferences: {},
      });
      mockDb.none.mockResolvedValue(undefined); // Refresh token insert

      const result = await registerUser(mockDb, {
        email: 'test@example.com',
        password: 'SecurePassword123!',
        name: 'Test User',
      });

      expect(result).toHaveProperty('user');
      expect(result).toHaveProperty('token');
      expect(result).toHaveProperty('refreshToken');
      expect(result.user.email).toBe('test@example.com');
      expect(authUtils.hashPassword).toHaveBeenCalledWith('SecurePassword123!');
      expect(authUtils.generateAccessToken).toHaveBeenCalled();
    });

    it('should throw ValidationError for invalid email', async () => {
      (authUtils.validateEmail as jest.Mock).mockReturnValue(false);

      await expect(
        registerUser(mockDb, {
          email: 'invalid-email',
          password: 'SecurePassword123!',
        })
      ).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError for weak password', async () => {
      (authUtils.validatePasswordStrength as jest.Mock).mockReturnValue({
        valid: false,
        errors: ['Password must be at least 12 characters long'],
      });

      await expect(
        registerUser(mockDb, {
          email: 'test@example.com',
          password: 'weak',
        })
      ).rejects.toThrow(ValidationError);
    });

    it('should throw ConflictError if email already exists', async () => {
      mockDb.oneOrNone.mockResolvedValue({
        id: 'existing-user',
        email: 'test@example.com',
      });

      await expect(
        registerUser(mockDb, {
          email: 'test@example.com',
          password: 'SecurePassword123!',
        })
      ).rejects.toThrow(ConflictError);
    });
  });

  describe('loginUser', () => {
    const mockUser = {
      id: 'user-123',
      email: 'test@example.com',
      password_hash: 'hashed_password',
      name: 'Test User',
      username: null,
      created_at: new Date(),
      last_login: null,
      preferences: {},
      is_active: true,
    };

    it('should successfully login a user with valid credentials', async () => {
      mockDb.oneOrNone.mockResolvedValue(mockUser);
      mockDb.none.mockResolvedValue(undefined); // Update last_login and refresh token

      const result = await loginUser(mockDb, {
        email: 'test@example.com',
        password: 'SecurePassword123!',
      });

      expect(result).toHaveProperty('user');
      expect(result).toHaveProperty('token');
      expect(result).toHaveProperty('refreshToken');
      expect(result.user.email).toBe('test@example.com');
      expect(authUtils.comparePassword).toHaveBeenCalledWith(
        'SecurePassword123!',
        'hashed_password'
      );
    });

    it('should throw UnauthorizedError for non-existent email', async () => {
      mockDb.oneOrNone.mockResolvedValue(null);

      await expect(
        loginUser(mockDb, {
          email: 'nonexistent@example.com',
          password: 'SecurePassword123!',
        })
      ).rejects.toThrow(UnauthorizedError);
    });

    it('should throw UnauthorizedError for wrong password', async () => {
      mockDb.oneOrNone.mockResolvedValue(mockUser);
      (authUtils.comparePassword as jest.Mock).mockResolvedValue(false);

      await expect(
        loginUser(mockDb, {
          email: 'test@example.com',
          password: 'WrongPassword123!',
        })
      ).rejects.toThrow(UnauthorizedError);
    });

    it('should throw UnauthorizedError for inactive user', async () => {
      mockDb.oneOrNone.mockResolvedValue({
        ...mockUser,
        is_active: false,
      });

      await expect(
        loginUser(mockDb, {
          email: 'test@example.com',
          password: 'SecurePassword123!',
        })
      ).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('getUserById', () => {
    it('should return user by ID', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        username: null,
        created_at: new Date(),
        last_login: null,
        preferences: {},
      };

      mockDb.oneOrNone.mockResolvedValue(mockUser);

      const result = await getUserById(mockDb, 'user-123');

      expect(result).toEqual(mockUser);
      expect(mockDb.oneOrNone).toHaveBeenCalledWith(
        expect.stringContaining('SELECT id, email, name'),
        ['user-123']
      );
    });

    it('should return null if user not found', async () => {
      mockDb.oneOrNone.mockResolvedValue(null);

      const result = await getUserById(mockDb, 'nonexistent-id');

      expect(result).toBeNull();
    });
  });

  describe('createRefreshToken', () => {
    it('should create a valid refresh token', async () => {
      mockDb.none.mockResolvedValue(undefined);

      const token = await createRefreshToken(mockDb, 'user-123');

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.length).toBe(128); // 64 bytes = 128 hex chars
      expect(mockDb.none).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO refresh_tokens'),
        expect.arrayContaining(['user-123'])
      );
    });
  });

  describe('refreshAccessToken', () => {
    const mockTokenRecord = {
      id: 'token-123',
      user_id: 'user-123',
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
      revoked: false,
    };

    const mockUser = {
      id: 'user-123',
      email: 'test@example.com',
      name: 'Test User',
      username: null,
      created_at: new Date(),
      last_login: null,
      preferences: {},
    };

    it('should successfully refresh access token', async () => {
      mockDb.oneOrNone
        .mockResolvedValueOnce(mockTokenRecord) // Find token
        .mockResolvedValueOnce(mockUser); // Get user
      mockDb.none.mockResolvedValue(undefined); // Revoke old token and create new one

      const result = await refreshAccessToken(mockDb, 'valid_refresh_token');

      expect(result).toHaveProperty('token');
      expect(result).toHaveProperty('refreshToken');
      expect(mockDb.none).toHaveBeenCalledTimes(2); // Revoke old + create new
    });

    it('should throw UnauthorizedError for invalid token', async () => {
      mockDb.oneOrNone.mockResolvedValue(null);

      await expect(refreshAccessToken(mockDb, 'invalid_token')).rejects.toThrow(
        UnauthorizedError
      );
    });

    it('should throw UnauthorizedError for revoked token', async () => {
      mockDb.oneOrNone.mockResolvedValue({
        ...mockTokenRecord,
        revoked: true,
      });

      await expect(refreshAccessToken(mockDb, 'revoked_token')).rejects.toThrow(
        UnauthorizedError
      );
    });

    it('should throw UnauthorizedError for expired token', async () => {
      mockDb.oneOrNone.mockResolvedValue({
        ...mockTokenRecord,
        expires_at: new Date(Date.now() - 1000), // Expired
      });

      await expect(refreshAccessToken(mockDb, 'expired_token')).rejects.toThrow(
        UnauthorizedError
      );
    });
  });

  describe('revokeRefreshToken', () => {
    it('should successfully revoke a refresh token', async () => {
      mockDb.result.mockResolvedValue({ rowCount: 1 });

      await revokeRefreshToken(mockDb, 'valid_refresh_token');

      expect(mockDb.result).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE refresh_tokens'),
        expect.any(Array)
      );
    });

    it('should not throw error if token not found', async () => {
      mockDb.result.mockResolvedValue({ rowCount: 0 });

      await expect(revokeRefreshToken(mockDb, 'nonexistent_token')).resolves.not.toThrow();
    });
  });

  describe('cleanupExpiredTokens', () => {
    it('should delete expired tokens and return count', async () => {
      mockDb.result.mockResolvedValue({ rowCount: 5 });

      const count = await cleanupExpiredTokens(mockDb);

      expect(count).toBe(5);
      expect(mockDb.result).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM refresh_tokens')
      );
    });

    it('should return 0 if no tokens to cleanup', async () => {
      mockDb.result.mockResolvedValue({ rowCount: 0 });

      const count = await cleanupExpiredTokens(mockDb);

      expect(count).toBe(0);
    });
  });
});
