/**
 * Authentication middleware
 * Validates JWT tokens and attaches user info to request
 */

import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, extractTokenFromHeader } from '../utils/auth';
import { getCacheService } from '../config/redis';
import { UnauthorizedError } from '../types';
import logger from '../utils/logger';

// Extend Express Request type to include user
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
      };
    }
  }
}

/**
 * Authentication middleware
 * Verifies JWT token and attaches user to request
 */
export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Extract token from header
    const token = extractTokenFromHeader(req.headers.authorization);

    // Check if token is blacklisted
    const cache = getCacheService();
    const isBlacklisted = await cache.isTokenBlacklisted(token);

    if (isBlacklisted) {
      throw new UnauthorizedError('Token has been revoked');
    }

    // Verify token
    const payload = verifyAccessToken(token);

    // Attach user info to request
    req.user = {
      id: payload.sub,
      email: payload.email,
    };

    next();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      res.status(401).json({
        error: error.message,
        code: error.code,
      });
    } else {
      logger.error('Authentication error:', error);
      res.status(401).json({
        error: 'Authentication failed',
        code: 'UNAUTHORIZED',
      });
    }
  }
}

/**
 * Optional authentication middleware
 * Attaches user if token is present, but doesn't fail if absent
 */
export async function optionalAuthenticate(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return next();
    }

    const token = extractTokenFromHeader(authHeader);
    const cache = getCacheService();
    const isBlacklisted = await cache.isTokenBlacklisted(token);

    if (!isBlacklisted) {
      const payload = verifyAccessToken(token);
      req.user = {
        id: payload.sub,
        email: payload.email,
      };
    }

    next();
  } catch (error) {
    // Ignore errors in optional auth
    next();
  }
}

/**
 * Authorization helper
 * Throws error if user is not authenticated
 */
export function requireAuth(req: Request): { id: string; email: string } {
  if (!req.user) {
    throw new UnauthorizedError('Authentication required');
  }
  return req.user;
}
