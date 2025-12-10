/**
 * Authentication routes
 * Handles user registration, login, logout, and token refresh
 */

import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { asyncHandler } from '../middleware/errorHandler';
import { authenticate, requireAuth } from '../middleware/auth';
import { authRateLimiter } from '../middleware/rateLimiter';
import { getDatabase } from '../config/database';
import { getCacheService } from '../config/redis';
import { getTokenExpiresIn, extractTokenFromHeader } from '../utils/auth';
import {
  registerUser,
  loginUser,
  refreshAccessToken,
  getUserById,
  revokeRefreshToken,
} from '../services/authService';
import { ValidationError } from '../types';

const router = Router();

// Validation middleware
const validateRegistration = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password').isString().isLength({ min: 12 }).withMessage('Password must be at least 12 characters'),
  body('name').optional().isString().isLength({ max: 255 }).withMessage('Name must be at most 255 characters'),
  body('username').optional().isString().isLength({ max: 100 }).withMessage('Username must be at most 100 characters'),
];

const validateLogin = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password').isString().notEmpty().withMessage('Password is required'),
];

const validateRefresh = [
  body('refreshToken').isString().notEmpty().withMessage('Refresh token is required'),
];

const validateLogout = [
  body('refreshToken').isString().notEmpty().withMessage('Refresh token is required'),
];

/**
 * Helper to check validation results
 */
function checkValidation(req: Request): void {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw new ValidationError('Validation failed', { errors: errors.array() });
  }
}

/**
 * POST /auth/register
 * Register a new user
 */
router.post(
  '/register',
  authRateLimiter,
  validateRegistration,
  asyncHandler(async (req: Request, res: Response) => {
    checkValidation(req);

    const db = getDatabase();
    const { email, password, name, username } = req.body;

    const result = await registerUser(db, {
      email,
      password,
      name,
      username,
    });

    res.status(201).json({
      user_id: result.user.id,
      email: result.user.email,
      name: result.user.name,
      username: result.user.username,
      token: result.token,
      refreshToken: result.refreshToken,
      expires_in: getTokenExpiresIn(),
    });
  })
);

/**
 * POST /auth/login
 * Login user and return access/refresh tokens
 */
router.post(
  '/login',
  authRateLimiter,
  validateLogin,
  asyncHandler(async (req: Request, res: Response) => {
    checkValidation(req);

    const db = getDatabase();
    const { email, password } = req.body;

    const result = await loginUser(db, { email, password });

    res.status(200).json({
      user_id: result.user.id,
      email: result.user.email,
      name: result.user.name,
      username: result.user.username,
      token: result.token,
      refreshToken: result.refreshToken,
      expires_in: getTokenExpiresIn(),
    });
  })
);

/**
 * POST /auth/refresh
 * Refresh access token using refresh token
 */
router.post(
  '/refresh',
  validateRefresh,
  asyncHandler(async (req: Request, res: Response) => {
    checkValidation(req);

    const db = getDatabase();
    const { refreshToken } = req.body;

    const result = await refreshAccessToken(db, refreshToken);

    res.status(200).json({
      token: result.token,
      refreshToken: result.refreshToken,
      expires_in: getTokenExpiresIn(),
    });
  })
);

/**
 * GET /auth/me
 * Get current user profile
 */
router.get(
  '/me',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const user = requireAuth(req);
    const db = getDatabase();

    const userProfile = await getUserById(db, user.id);

    if (!userProfile) {
      res.status(404).json({
        error: 'User not found',
        code: 'NOT_FOUND',
      });
      return;
    }

    res.status(200).json({
      user_id: userProfile.id,
      email: userProfile.email,
      name: userProfile.name,
      username: userProfile.username,
      created_at: userProfile.created_at,
      last_login: userProfile.last_login,
      preferences: userProfile.preferences,
    });
  })
);

/**
 * POST /auth/logout
 * Logout user and revoke refresh token
 */
router.post(
  '/logout',
  authenticate,
  validateLogout,
  asyncHandler(async (req: Request, res: Response) => {
    checkValidation(req);

    requireAuth(req);
    const db = getDatabase();
    const cache = getCacheService();
    const { refreshToken } = req.body;

    // Revoke refresh token
    await revokeRefreshToken(db, refreshToken);

    // Blacklist access token (optional but good practice)
    const accessToken = extractTokenFromHeader(req.headers.authorization);
    const expiresIn = getTokenExpiresIn();
    await cache.blacklistToken(accessToken, expiresIn);

    res.status(200).json({
      message: 'Logged out successfully',
    });
  })
);

export default router;
