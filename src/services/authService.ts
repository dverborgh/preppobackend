/**
 * Authentication service
 * Handles user registration, login, token management
 */

import crypto from 'crypto';
import { ExtendedDatabase } from '../config/database';
import {
  hashPassword,
  comparePassword,
  generateAccessToken,
  validatePasswordStrength,
  validateEmail,
} from '../utils/auth';
import {
  ConflictError,
  UnauthorizedError,
  ValidationError,
  NotFoundError,
} from '../types';
import logger, { logSecurityEvent } from '../utils/logger';

export interface RegisterUserData {
  email: string;
  password: string;
  name?: string;
  username?: string;
}

export interface LoginUserData {
  email: string;
  password: string;
}

export interface UserResponse {
  id: string;
  email: string;
  name: string | null;
  username: string | null;
  created_at: Date;
  last_login: Date | null;
  preferences: any;
}

/**
 * Register a new user
 * Creates user account with hashed password and returns auth tokens
 */
export async function registerUser(
  db: ExtendedDatabase,
  data: RegisterUserData
): Promise<{ user: UserResponse; token: string; refreshToken: string }> {
  // Validate email format
  if (!validateEmail(data.email)) {
    throw new ValidationError('Invalid email format');
  }

  // Validate password strength
  const passwordValidation = validatePasswordStrength(data.password);
  if (!passwordValidation.valid) {
    throw new ValidationError('Password does not meet requirements', {
      errors: passwordValidation.errors,
    });
  }

  // Check if email already exists
  const existingUser = await getUserByEmail(db, data.email);
  if (existingUser) {
    throw new ConflictError('Email already registered');
  }

  // Hash password
  const passwordHash = await hashPassword(data.password);

  // Insert user into database
  const user = await db.one<UserResponse>(
    `INSERT INTO users (email, password_hash, name, username, is_active)
     VALUES ($1, $2, $3, $4, true)
     RETURNING id, email, name, username, created_at, last_login, preferences`,
    [data.email, passwordHash, data.name || null, data.username || null]
  );

  // Generate tokens
  const token = generateAccessToken(user.id, user.email);
  const refreshToken = await createRefreshToken(db, user.id);

  // Log registration event
  logSecurityEvent({
    event: 'user_registered',
    user_id: user.id,
    details: { email: user.email },
  });

  logger.info('User registered successfully', {
    user_id: user.id,
    email: user.email,
  });

  return { user, token, refreshToken };
}

/**
 * Login user with credentials
 * Validates credentials and returns auth tokens
 */
export async function loginUser(
  db: ExtendedDatabase,
  data: LoginUserData
): Promise<{ user: UserResponse; token: string; refreshToken: string }> {
  // Get user by email
  const user = await db.oneOrNone<{
    id: string;
    email: string;
    password_hash: string;
    name: string | null;
    username: string | null;
    created_at: Date;
    last_login: Date | null;
    preferences: any;
    is_active: boolean;
  }>(
    `SELECT id, email, password_hash, name, username, created_at, last_login, preferences, is_active
     FROM users
     WHERE email = $1`,
    [data.email]
  );

  if (!user) {
    logSecurityEvent({
      event: 'login_failed_user_not_found',
      details: { email: data.email },
    });
    throw new UnauthorizedError('Invalid email or password');
  }

  // Check if user is active
  if (!user.is_active) {
    logSecurityEvent({
      event: 'login_failed_user_inactive',
      user_id: user.id,
      details: { email: data.email },
    });
    throw new UnauthorizedError('Account is inactive');
  }

  // Verify password
  const isPasswordValid = await comparePassword(data.password, user.password_hash);
  if (!isPasswordValid) {
    logSecurityEvent({
      event: 'login_failed_wrong_password',
      user_id: user.id,
      details: { email: data.email },
    });
    throw new UnauthorizedError('Invalid email or password');
  }

  // Update last login timestamp
  await updateLastLogin(db, user.id);

  // Generate tokens
  const token = generateAccessToken(user.id, user.email);
  const refreshToken = await createRefreshToken(db, user.id);

  // Log successful login
  logSecurityEvent({
    event: 'login_success',
    user_id: user.id,
    details: { email: user.email },
  });

  logger.info('User logged in successfully', {
    user_id: user.id,
    email: user.email,
  });

  // Return user without password_hash
  const userResponse: UserResponse = {
    id: user.id,
    email: user.email,
    name: user.name,
    username: user.username,
    created_at: user.created_at,
    last_login: new Date(), // Will be updated in DB
    preferences: user.preferences,
  };

  return { user: userResponse, token, refreshToken };
}

/**
 * Get user by ID
 * Returns user profile data without password hash
 */
export async function getUserById(
  db: ExtendedDatabase,
  userId: string
): Promise<UserResponse | null> {
  const user = await db.oneOrNone<UserResponse>(
    `SELECT id, email, name, username, created_at, last_login, preferences
     FROM users
     WHERE id = $1 AND is_active = true`,
    [userId]
  );

  return user;
}

/**
 * Get user by email
 * Internal use only - includes password_hash
 */
export async function getUserByEmail(
  db: ExtendedDatabase,
  email: string
): Promise<any | null> {
  const user = await db.oneOrNone(
    `SELECT id, email, password_hash, name, username, created_at, last_login, preferences, is_active
     FROM users
     WHERE email = $1`,
    [email]
  );

  return user;
}

/**
 * Update last login timestamp
 */
export async function updateLastLogin(
  db: ExtendedDatabase,
  userId: string
): Promise<void> {
  await db.none(
    `UPDATE users
     SET last_login = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [userId]
  );
}

/**
 * Create refresh token
 * Generates random token, stores SHA256 hash in database
 */
export async function createRefreshToken(
  db: ExtendedDatabase,
  userId: string
): Promise<string> {
  // Generate random token (64 bytes = 128 hex characters)
  const token = crypto.randomBytes(64).toString('hex');

  // Hash token for storage (SHA256)
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  // Calculate expiration (7 days)
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  // Store token hash in database
  await db.none(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, revoked)
     VALUES ($1, $2, $3, false)`,
    [userId, tokenHash, expiresAt]
  );

  logger.debug('Refresh token created', { user_id: userId });

  return token;
}

/**
 * Verify and rotate refresh token
 * Validates refresh token, revokes old one, creates new one
 */
export async function refreshAccessToken(
  db: ExtendedDatabase,
  refreshToken: string
): Promise<{ token: string; refreshToken: string }> {
  // Hash the provided token
  const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

  // Find token in database
  const tokenRecord = await db.oneOrNone<{
    id: string;
    user_id: string;
    expires_at: Date;
    revoked: boolean;
  }>(
    `SELECT id, user_id, expires_at, revoked
     FROM refresh_tokens
     WHERE token_hash = $1`,
    [tokenHash]
  );

  if (!tokenRecord) {
    logSecurityEvent({
      event: 'refresh_token_not_found',
      details: { token_hash: tokenHash.substring(0, 8) },
    });
    throw new UnauthorizedError('Invalid refresh token');
  }

  // Check if token is revoked
  if (tokenRecord.revoked) {
    logSecurityEvent({
      event: 'refresh_token_revoked',
      user_id: tokenRecord.user_id,
      details: { token_id: tokenRecord.id },
    });
    throw new UnauthorizedError('Refresh token has been revoked');
  }

  // Check if token is expired
  if (new Date() > new Date(tokenRecord.expires_at)) {
    logSecurityEvent({
      event: 'refresh_token_expired',
      user_id: tokenRecord.user_id,
      details: { token_id: tokenRecord.id },
    });
    throw new UnauthorizedError('Refresh token has expired');
  }

  // Get user details
  const user = await getUserById(db, tokenRecord.user_id);
  if (!user) {
    throw new NotFoundError('User');
  }

  // Revoke old refresh token
  await db.none(
    `UPDATE refresh_tokens
     SET revoked = true, revoked_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [tokenRecord.id]
  );

  // Generate new tokens (token rotation)
  const newAccessToken = generateAccessToken(user.id, user.email);
  const newRefreshToken = await createRefreshToken(db, user.id);

  logSecurityEvent({
    event: 'token_refreshed',
    user_id: user.id,
    details: { old_token_id: tokenRecord.id },
  });

  logger.info('Access token refreshed', { user_id: user.id });

  return { token: newAccessToken, refreshToken: newRefreshToken };
}

/**
 * Revoke refresh token (logout)
 * Marks refresh token as revoked
 */
export async function revokeRefreshToken(
  db: ExtendedDatabase,
  refreshToken: string
): Promise<void> {
  // Hash the provided token
  const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

  // Revoke token
  const result = await db.result(
    `UPDATE refresh_tokens
     SET revoked = true, revoked_at = CURRENT_TIMESTAMP
     WHERE token_hash = $1 AND revoked = false`,
    [tokenHash]
  );

  if (result.rowCount === 0) {
    // Token not found or already revoked - this is fine, just log it
    logger.debug('Refresh token not found or already revoked', {
      token_hash: tokenHash.substring(0, 8),
    });
  } else {
    logSecurityEvent({
      event: 'refresh_token_revoked_manual',
      details: { token_hash: tokenHash.substring(0, 8) },
    });
    logger.info('Refresh token revoked');
  }
}

/**
 * Cleanup expired refresh tokens
 * Background job to delete old expired tokens
 */
export async function cleanupExpiredTokens(db: ExtendedDatabase): Promise<number> {
  const result = await db.result(
    `DELETE FROM refresh_tokens
     WHERE expires_at < CURRENT_TIMESTAMP
     OR (revoked = true AND revoked_at < CURRENT_TIMESTAMP - INTERVAL '30 days')`
  );

  const deletedCount = result.rowCount;

  if (deletedCount > 0) {
    logger.info(`Cleaned up ${deletedCount} expired refresh tokens`);
  }

  return deletedCount;
}
