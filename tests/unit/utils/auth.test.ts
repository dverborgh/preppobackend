/**
 * Unit tests for auth utilities
 * Tests password hashing, token generation/validation, and password strength validation
 */

import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';
import {
  hashPassword,
  comparePassword,
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  extractTokenFromHeader,
  getTokenExpiresIn,
  validatePasswordStrength,
  validateEmail,
} from '../../../src/utils/auth';
import { UnauthorizedError } from '../../../src/types';
import config from '../../../src/config';

// Mock dependencies
jest.mock('bcrypt');
jest.mock('jsonwebtoken');
jest.mock('../../../src/config', () => ({
  jwt: {
    secret: 'test-secret',
    refreshSecret: 'test-refresh-secret',
    expiresIn: '24h',
    refreshExpiresIn: '7d',
    issuer: 'preppo-test',
  },
}));

describe('Auth Utilities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Password Hashing', () => {
    describe('hashPassword', () => {
      it('should hash password using bcrypt with 12 rounds', async () => {
        const mockHash = 'hashed_password_123';
        (bcrypt.hash as jest.Mock).mockResolvedValue(mockHash);

        const result = await hashPassword('MyPassword123!');

        expect(bcrypt.hash).toHaveBeenCalledWith('MyPassword123!', 12);
        expect(result).toBe(mockHash);
      });

      it('should handle different passwords', async () => {
        (bcrypt.hash as jest.Mock).mockResolvedValue('hash1');
        await hashPassword('password1');

        (bcrypt.hash as jest.Mock).mockResolvedValue('hash2');
        await hashPassword('password2');

        expect(bcrypt.hash).toHaveBeenCalledTimes(2);
      });
    });

    describe('comparePassword', () => {
      it('should verify correct password', async () => {
        (bcrypt.compare as jest.Mock).mockResolvedValue(true);

        const result = await comparePassword('MyPassword123!', 'hashed_password');

        expect(bcrypt.compare).toHaveBeenCalledWith('MyPassword123!', 'hashed_password');
        expect(result).toBe(true);
      });

      it('should reject wrong password', async () => {
        (bcrypt.compare as jest.Mock).mockResolvedValue(false);

        const result = await comparePassword('WrongPassword', 'hashed_password');

        expect(bcrypt.compare).toHaveBeenCalledWith('WrongPassword', 'hashed_password');
        expect(result).toBe(false);
      });

      it('should handle empty password', async () => {
        (bcrypt.compare as jest.Mock).mockResolvedValue(false);

        const result = await comparePassword('', 'hashed_password');

        expect(result).toBe(false);
      });
    });
  });

  describe('Token Generation', () => {
    describe('generateAccessToken', () => {
      it('should generate valid JWT access token', () => {
        const mockToken = 'access_token_123';
        (jwt.sign as jest.Mock).mockReturnValue(mockToken);

        const result = generateAccessToken('user-123', 'test@example.com');

        expect(jwt.sign).toHaveBeenCalledWith(
          {
            sub: 'user-123',
            email: 'test@example.com',
            iss: 'preppo-test',
          },
          'test-secret',
          {
            expiresIn: '24h',
            algorithm: 'HS256',
          }
        );
        expect(result).toBe(mockToken);
      });

      it('should create tokens with different user IDs', () => {
        (jwt.sign as jest.Mock).mockReturnValue('token1');
        generateAccessToken('user-1', 'user1@test.com');

        (jwt.sign as jest.Mock).mockReturnValue('token2');
        generateAccessToken('user-2', 'user2@test.com');

        expect(jwt.sign).toHaveBeenCalledTimes(2);
        expect(jwt.sign).toHaveBeenNthCalledWith(
          1,
          expect.objectContaining({ sub: 'user-1', email: 'user1@test.com' }),
          expect.any(String),
          expect.any(Object)
        );
        expect(jwt.sign).toHaveBeenNthCalledWith(
          2,
          expect.objectContaining({ sub: 'user-2', email: 'user2@test.com' }),
          expect.any(String),
          expect.any(Object)
        );
      });
    });

    describe('generateRefreshToken', () => {
      it('should generate valid JWT refresh token', () => {
        const mockToken = 'refresh_token_456';
        (jwt.sign as jest.Mock).mockReturnValue(mockToken);

        const result = generateRefreshToken('user-123', 'test@example.com');

        expect(jwt.sign).toHaveBeenCalledWith(
          {
            sub: 'user-123',
            email: 'test@example.com',
            iss: 'preppo-test',
          },
          'test-refresh-secret',
          {
            expiresIn: '7d',
            algorithm: 'HS256',
          }
        );
        expect(result).toBe(mockToken);
      });

      it('should use different secret than access token', () => {
        (jwt.sign as jest.Mock).mockReturnValue('token');

        generateAccessToken('user-123', 'test@example.com');
        const accessCall = (jwt.sign as jest.Mock).mock.calls[0];

        generateRefreshToken('user-123', 'test@example.com');
        const refreshCall = (jwt.sign as jest.Mock).mock.calls[1];

        expect(accessCall[1]).toBe('test-secret');
        expect(refreshCall[1]).toBe('test-refresh-secret');
      });
    });
  });

  describe('Token Verification', () => {
    describe('verifyAccessToken', () => {
      it('should verify valid access token', () => {
        const mockPayload = {
          sub: 'user-123',
          email: 'test@example.com',
          iss: 'preppo-test',
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 86400,
        };
        (jwt.verify as jest.Mock).mockReturnValue(mockPayload);

        const result = verifyAccessToken('valid_token');

        expect(jwt.verify).toHaveBeenCalledWith('valid_token', 'test-secret', {
          issuer: 'preppo-test',
          algorithms: ['HS256'],
        });
        expect(result).toEqual(mockPayload);
      });

      it('should throw UnauthorizedError for expired token', () => {
        const expiredError = new jwt.TokenExpiredError('Token expired', new Date());
        (jwt.verify as jest.Mock).mockImplementation(() => {
          throw expiredError;
        });

        expect(() => verifyAccessToken('expired_token')).toThrow(UnauthorizedError);
        expect(() => verifyAccessToken('expired_token')).toThrow('Token expired');
      });

      it('should throw UnauthorizedError for invalid token', () => {
        const invalidError = new jwt.JsonWebTokenError('Invalid token');
        (jwt.verify as jest.Mock).mockImplementation(() => {
          throw invalidError;
        });

        expect(() => verifyAccessToken('invalid_token')).toThrow(UnauthorizedError);
        expect(() => verifyAccessToken('invalid_token')).toThrow('Invalid token');
      });

      it('should throw UnauthorizedError for generic verification failure', () => {
        (jwt.verify as jest.Mock).mockImplementation(() => {
          throw new Error('Unknown error');
        });

        expect(() => verifyAccessToken('bad_token')).toThrow(UnauthorizedError);
        expect(() => verifyAccessToken('bad_token')).toThrow('Token verification failed');
      });
    });

    describe('verifyRefreshToken', () => {
      it('should verify valid refresh token', () => {
        const mockPayload = {
          sub: 'user-456',
          email: 'test@example.com',
          iss: 'preppo-test',
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 604800,
        };
        (jwt.verify as jest.Mock).mockReturnValue(mockPayload);

        const result = verifyRefreshToken('valid_refresh_token');

        expect(jwt.verify).toHaveBeenCalledWith('valid_refresh_token', 'test-refresh-secret', {
          issuer: 'preppo-test',
          algorithms: ['HS256'],
        });
        expect(result).toEqual(mockPayload);
      });

      it('should throw UnauthorizedError for expired refresh token', () => {
        const expiredError = new jwt.TokenExpiredError('Token expired', new Date());
        (jwt.verify as jest.Mock).mockImplementation(() => {
          throw expiredError;
        });

        expect(() => verifyRefreshToken('expired_token')).toThrow(UnauthorizedError);
        expect(() => verifyRefreshToken('expired_token')).toThrow('Refresh token expired');
      });

      it('should throw UnauthorizedError for invalid refresh token', () => {
        const invalidError = new jwt.JsonWebTokenError('Invalid token');
        (jwt.verify as jest.Mock).mockImplementation(() => {
          throw invalidError;
        });

        expect(() => verifyRefreshToken('invalid_token')).toThrow(UnauthorizedError);
        expect(() => verifyRefreshToken('invalid_token')).toThrow('Invalid refresh token');
      });

      it('should use different secret than access token', () => {
        (jwt.verify as jest.Mock).mockReturnValue({ sub: 'user-123', email: 'test@example.com' });

        verifyAccessToken('access_token');
        const accessCall = (jwt.verify as jest.Mock).mock.calls[0];

        verifyRefreshToken('refresh_token');
        const refreshCall = (jwt.verify as jest.Mock).mock.calls[1];

        expect(accessCall[1]).toBe('test-secret');
        expect(refreshCall[1]).toBe('test-refresh-secret');
      });
    });
  });

  describe('extractTokenFromHeader', () => {
    it('should extract token from valid Bearer header', () => {
      const result = extractTokenFromHeader('Bearer my_token_123');

      expect(result).toBe('my_token_123');
    });

    it('should throw UnauthorizedError for missing header', () => {
      expect(() => extractTokenFromHeader(undefined)).toThrow(UnauthorizedError);
      expect(() => extractTokenFromHeader(undefined)).toThrow('No authorization header');
    });

    it('should throw UnauthorizedError for invalid format (missing Bearer)', () => {
      expect(() => extractTokenFromHeader('my_token_123')).toThrow(UnauthorizedError);
      expect(() => extractTokenFromHeader('my_token_123')).toThrow(
        'Invalid authorization header format'
      );
    });

    it('should throw UnauthorizedError for invalid format (wrong prefix)', () => {
      expect(() => extractTokenFromHeader('Basic my_token_123')).toThrow(UnauthorizedError);
      expect(() => extractTokenFromHeader('Basic my_token_123')).toThrow(
        'Invalid authorization header format'
      );
    });

    it('should extract empty token from Bearer header', () => {
      // "Bearer " has 2 parts: ['Bearer', ''], so it extracts empty string
      const result = extractTokenFromHeader('Bearer ');
      expect(result).toBe('');
    });

    it('should handle tokens with special characters', () => {
      const complexToken =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc';
      const result = extractTokenFromHeader(`Bearer ${complexToken}`);

      expect(result).toBe(complexToken);
    });
  });

  describe('getTokenExpiresIn', () => {
    it('should parse seconds format', () => {
      const originalExpiresIn = config.jwt.expiresIn;
      config.jwt.expiresIn = '300s';

      const result = getTokenExpiresIn();

      expect(result).toBe(300);
      config.jwt.expiresIn = originalExpiresIn;
    });

    it('should parse minutes format', () => {
      const originalExpiresIn = config.jwt.expiresIn;
      config.jwt.expiresIn = '30m';

      const result = getTokenExpiresIn();

      expect(result).toBe(1800); // 30 * 60
      config.jwt.expiresIn = originalExpiresIn;
    });

    it('should parse hours format', () => {
      const originalExpiresIn = config.jwt.expiresIn;
      config.jwt.expiresIn = '24h';

      const result = getTokenExpiresIn();

      expect(result).toBe(86400); // 24 * 3600
      config.jwt.expiresIn = originalExpiresIn;
    });

    it('should parse days format', () => {
      const originalExpiresIn = config.jwt.expiresIn;
      config.jwt.expiresIn = '7d';

      const result = getTokenExpiresIn();

      expect(result).toBe(604800); // 7 * 86400
      config.jwt.expiresIn = originalExpiresIn;
    });

    it('should return default 24h for invalid format', () => {
      const originalExpiresIn = config.jwt.expiresIn;
      config.jwt.expiresIn = 'invalid';

      const result = getTokenExpiresIn();

      expect(result).toBe(86400); // Default 24 hours
      config.jwt.expiresIn = originalExpiresIn;
    });

    it('should return default for empty string', () => {
      const originalExpiresIn = config.jwt.expiresIn;
      config.jwt.expiresIn = '';

      const result = getTokenExpiresIn();

      expect(result).toBe(86400);
      config.jwt.expiresIn = originalExpiresIn;
    });
  });

  describe('validatePasswordStrength', () => {
    it('should accept strong password with all requirements', () => {
      const result = validatePasswordStrength('SecurePass123!');

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject password that is too short', () => {
      const result = validatePasswordStrength('Short1!');

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Password must be at least 12 characters long');
    });

    it('should reject password without lowercase letter', () => {
      const result = validatePasswordStrength('ALLUPPERCASE123!');

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Password must contain at least one lowercase letter');
    });

    it('should reject password without uppercase letter', () => {
      const result = validatePasswordStrength('alllowercase123!');

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Password must contain at least one uppercase letter');
    });

    it('should reject password without number', () => {
      const result = validatePasswordStrength('NoNumbersHere!');

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Password must contain at least one number');
    });

    it('should reject password without special character', () => {
      const result = validatePasswordStrength('NoSpecialChar123');

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Password must contain at least one special character');
    });

    it('should return multiple errors for weak password', () => {
      const result = validatePasswordStrength('weak');

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(1);
      expect(result.errors).toContain('Password must be at least 12 characters long');
      expect(result.errors).toContain('Password must contain at least one uppercase letter');
      expect(result.errors).toContain('Password must contain at least one number');
      expect(result.errors).toContain('Password must contain at least one special character');
    });

    it('should accept password with exactly 12 characters', () => {
      const result = validatePasswordStrength('Pass1234567!');

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should accept password with multiple special characters', () => {
      const result = validatePasswordStrength('Complex!@#$Pass123');

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should handle empty password', () => {
      const result = validatePasswordStrength('');

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should accept password with spaces and special chars', () => {
      const result = validatePasswordStrength('My Pass Phrase 123!');

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('validateEmail', () => {
    it('should accept valid email addresses', () => {
      expect(validateEmail('test@example.com')).toBe(true);
      expect(validateEmail('user.name@company.co.uk')).toBe(true);
      expect(validateEmail('first+last@domain.org')).toBe(true);
      expect(validateEmail('user123@test-domain.com')).toBe(true);
    });

    it('should reject invalid email addresses', () => {
      expect(validateEmail('invalid')).toBe(false);
      expect(validateEmail('invalid@')).toBe(false);
      expect(validateEmail('@example.com')).toBe(false);
      expect(validateEmail('user@')).toBe(false);
      expect(validateEmail('user@domain')).toBe(false);
    });

    it('should reject email without @ symbol', () => {
      expect(validateEmail('userexample.com')).toBe(false);
    });

    it('should reject email with spaces', () => {
      expect(validateEmail('user @example.com')).toBe(false);
      expect(validateEmail('user@ example.com')).toBe(false);
    });

    it('should reject empty email', () => {
      expect(validateEmail('')).toBe(false);
    });

    it('should reject email without domain extension', () => {
      expect(validateEmail('user@domain')).toBe(false);
    });

    it('should accept email with subdomain', () => {
      expect(validateEmail('user@mail.company.com')).toBe(true);
    });

    it('should accept email with numbers', () => {
      expect(validateEmail('user123@test123.com')).toBe(true);
    });
  });
});
