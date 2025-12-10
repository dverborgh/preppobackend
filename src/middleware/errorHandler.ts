/**
 * Global error handling middleware
 */

import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { AppError, InvalidFileTypeError, FileSizeLimitError } from '../types';
import logger from '../utils/logger';

/**
 * Error handler middleware
 * Catches all errors and sends appropriate response
 */
export function errorHandler(
  err: Error | AppError,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Log error
  logger.error('Error handler caught error:', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    user_id: req.user?.id,
  });

  // Handle known AppError instances
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: err.message,
      code: err.code,
      ...(err.details && { details: err.details }),
    });
    return;
  }

  // Handle multer errors
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({
        error: 'File size exceeds limit',
        code: 'FILE_SIZE_LIMIT_EXCEEDED',
        details: err.message,
      });
      return;
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      res.status(400).json({
        error: 'Unexpected file field',
        code: 'INVALID_FILE_FIELD',
        details: err.message,
      });
      return;
    }
    res.status(400).json({
      error: 'File upload error',
      code: 'FILE_UPLOAD_ERROR',
      details: err.message,
    });
    return;
  }

  // Handle file type errors
  if (err instanceof InvalidFileTypeError) {
    res.status(err.statusCode).json({
      error: err.message,
      code: err.code,
    });
    return;
  }

  // Handle file size limit errors
  if (err instanceof FileSizeLimitError) {
    res.status(err.statusCode).json({
      error: err.message,
      code: err.code,
    });
    return;
  }

  // Handle validation errors from express-validator
  if (err.name === 'ValidationError') {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: err.message,
    });
    return;
  }

  // Handle database errors
  if (err.name === 'QueryResultError') {
    res.status(404).json({
      error: 'Resource not found',
      code: 'NOT_FOUND',
    });
    return;
  }

  // Handle unexpected errors
  res.status(500).json({
    error: 'Internal server error',
    code: 'INTERNAL_ERROR',
  });
}

/**
 * 404 handler for unknown routes
 */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: `Route ${req.method} ${req.path} not found`,
    code: 'NOT_FOUND',
  });
}

/**
 * Async handler wrapper
 * Wraps async route handlers to catch promise rejections
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
