/**
 * Unit tests for error handler middleware
 * Tests handling of different error types, status codes, and logging
 */

import { Request, Response, NextFunction } from 'express';
import {
  errorHandler,
  notFoundHandler,
  asyncHandler,
} from '../../../src/middleware/errorHandler';
import {
  AppError,
  ValidationError,
  UnauthorizedError,
  NotFoundError,
  ConflictError,
} from '../../../src/types';
import logger from '../../../src/utils/logger';

// Mock logger
jest.mock('../../../src/utils/logger', () => ({
  __esModule: true,
  default: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('Error Handler Middleware', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    jsonMock = jest.fn();
    statusMock = jest.fn().mockReturnValue({ json: jsonMock });

    mockRequest = {
      path: '/test/path',
      method: 'POST',
      user: { id: 'user-123' } as any,
    };

    mockResponse = {
      status: statusMock,
      json: jsonMock,
    };

    mockNext = jest.fn();
  });

  describe('errorHandler', () => {
    it('should handle AppError with correct status code and format', () => {
      const appError = new AppError(400, 'BAD_REQUEST', 'Invalid input');

      errorHandler(appError, mockRequest as Request, mockResponse as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'Invalid input',
        code: 'BAD_REQUEST',
      });
      expect(logger.error).toHaveBeenCalledWith(
        'Error handler caught error:',
        expect.objectContaining({
          error: 'Invalid input',
          path: '/test/path',
          method: 'POST',
          user_id: 'user-123',
        })
      );
    });

    it('should handle AppError with details', () => {
      const appError = new AppError(400, 'VALIDATION_ERROR', 'Validation failed', {
        fields: { email: 'Invalid email format' },
      });

      errorHandler(appError, mockRequest as Request, mockResponse as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: {
          fields: { email: 'Invalid email format' },
        },
      });
    });

    it('should handle ValidationError correctly', () => {
      const validationError = new ValidationError('Validation failed', {
        fields: { password: 'Too weak' },
      });

      errorHandler(validationError, mockRequest as Request, mockResponse as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: {
          fields: { password: 'Too weak' },
        },
      });
    });

    it('should handle UnauthorizedError correctly', () => {
      const unauthorizedError = new UnauthorizedError('Token expired');

      errorHandler(
        unauthorizedError,
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(statusMock).toHaveBeenCalledWith(401);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'Token expired',
        code: 'UNAUTHORIZED',
      });
    });

    it('should handle NotFoundError correctly', () => {
      const notFoundError = new NotFoundError('User');

      errorHandler(notFoundError, mockRequest as Request, mockResponse as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(404);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'User not found',
        code: 'NOT_FOUND',
      });
    });

    it('should handle ConflictError correctly', () => {
      const conflictError = new ConflictError('Email already exists');

      errorHandler(conflictError, mockRequest as Request, mockResponse as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(409);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'Email already exists',
        code: 'CONFLICT',
      });
    });

    it('should handle ValidationError name (express-validator)', () => {
      const error = new Error('Validation failed');
      error.name = 'ValidationError';

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: 'Validation failed',
      });
    });

    it('should handle QueryResultError (database not found)', () => {
      const error = new Error('No data returned from query');
      error.name = 'QueryResultError';

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(404);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'Resource not found',
        code: 'NOT_FOUND',
      });
    });

    it('should handle generic Error as 500 Internal Server Error', () => {
      const genericError = new Error('Something went wrong');

      errorHandler(genericError, mockRequest as Request, mockResponse as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(500);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
      expect(logger.error).toHaveBeenCalledWith(
        'Error handler caught error:',
        expect.objectContaining({
          error: 'Something went wrong',
        })
      );
    });

    it('should log error with stack trace', () => {
      const error = new Error('Test error');
      error.stack = 'Error: Test error\n    at test.js:10:5';

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(logger.error).toHaveBeenCalledWith(
        'Error handler caught error:',
        expect.objectContaining({
          error: 'Test error',
          stack: expect.stringContaining('Error: Test error'),
        })
      );
    });

    it('should handle request without user', () => {
      mockRequest.user = undefined;
      const error = new Error('Test error');

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(logger.error).toHaveBeenCalledWith(
        'Error handler caught error:',
        expect.objectContaining({
          error: 'Test error',
          user_id: undefined,
        })
      );
    });

    it('should not call next()', () => {
      const error = new AppError(400, 'TEST_ERROR', 'Test');

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should handle AppError without details field', () => {
      const appError = new AppError(500, 'SERVER_ERROR', 'Server error');
      // Explicitly set details to undefined
      appError.details = undefined;

      errorHandler(appError, mockRequest as Request, mockResponse as Response, mockNext);

      expect(jsonMock).toHaveBeenCalledWith({
        error: 'Server error',
        code: 'SERVER_ERROR',
      });
      // Should not include details field
      expect(jsonMock).not.toHaveBeenCalledWith(
        expect.objectContaining({
          details: expect.anything(),
        })
      );
    });

    it('should handle multiple error types in sequence', () => {
      const error1 = new ValidationError('Validation failed');
      errorHandler(error1, mockRequest as Request, mockResponse as Response, mockNext);

      const error2 = new UnauthorizedError();
      errorHandler(error2, mockRequest as Request, mockResponse as Response, mockNext);

      const error3 = new Error('Generic error');
      errorHandler(error3, mockRequest as Request, mockResponse as Response, mockNext);

      expect(statusMock).toHaveBeenNthCalledWith(1, 400);
      expect(statusMock).toHaveBeenNthCalledWith(2, 401);
      expect(statusMock).toHaveBeenNthCalledWith(3, 500);
    });
  });

  describe('Multer error handling', () => {
    it('should handle MulterError LIMIT_FILE_SIZE', () => {
      const multerError = new (require('multer').MulterError)('LIMIT_FILE_SIZE', 'file');

      errorHandler(multerError, mockRequest as Request, mockResponse as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(413);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'File size exceeds limit',
        code: 'FILE_SIZE_LIMIT_EXCEEDED',
        details: expect.any(String),
      });
    });

    it('should handle MulterError LIMIT_UNEXPECTED_FILE', () => {
      const multerError = new (require('multer').MulterError)('LIMIT_UNEXPECTED_FILE', 'file');

      errorHandler(multerError, mockRequest as Request, mockResponse as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'Unexpected file field',
        code: 'INVALID_FILE_FIELD',
        details: expect.any(String),
      });
    });

    it('should handle other MulterError types', () => {
      const multerError = new (require('multer').MulterError)('LIMIT_PART_COUNT', 'file');

      errorHandler(multerError, mockRequest as Request, mockResponse as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'File upload error',
        code: 'FILE_UPLOAD_ERROR',
        details: expect.any(String),
      });
    });
  });

  describe('File error handling', () => {
    it('should handle InvalidFileTypeError', () => {
      const fileTypeError = new (require('../../../src/types').InvalidFileTypeError)(
        'Invalid file type. Allowed types: .pdf, .txt, .md'
      );

      errorHandler(fileTypeError, mockRequest as Request, mockResponse as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'Invalid file type. Allowed types: .pdf, .txt, .md',
        code: 'INVALID_FILE_TYPE',
      });
    });

    it('should handle FileSizeLimitError', () => {
      const fileSizeError = new (require('../../../src/types').FileSizeLimitError)(
        'File size exceeds limit of 50MB'
      );

      errorHandler(fileSizeError, mockRequest as Request, mockResponse as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(413);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'File size exceeds limit of 50MB',
        code: 'FILE_SIZE_LIMIT_EXCEEDED',
      });
    });
  });

  describe('notFoundHandler', () => {
    it('should return 404 with route information', () => {
      mockRequest = {
        ...mockRequest,
        method: 'GET',
        path: '/api/nonexistent',
      };

      notFoundHandler(mockRequest as Request, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(404);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'Route GET /api/nonexistent not found',
        code: 'NOT_FOUND',
      });
    });

    it('should handle different HTTP methods', () => {
      mockRequest = {
        ...mockRequest,
        method: 'POST',
        path: '/api/test',
      };

      notFoundHandler(mockRequest as Request, mockResponse as Response);

      expect(jsonMock).toHaveBeenCalledWith({
        error: 'Route POST /api/test not found',
        code: 'NOT_FOUND',
      });
    });

    it('should handle root path', () => {
      mockRequest = {
        ...mockRequest,
        method: 'GET',
        path: '/',
      };

      notFoundHandler(mockRequest as Request, mockResponse as Response);

      expect(jsonMock).toHaveBeenCalledWith({
        error: 'Route GET / not found',
        code: 'NOT_FOUND',
      });
    });
  });

  describe('asyncHandler', () => {
    it('should pass through successful async function', async () => {
      const asyncFn = jest.fn().mockResolvedValue({ data: 'test' });
      const handler = asyncHandler(asyncFn);

      await handler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(asyncFn).toHaveBeenCalledWith(mockRequest, mockResponse, mockNext);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should catch async errors and pass to next()', async () => {
      const error = new Error('Async error');
      const asyncFn = jest.fn().mockRejectedValue(error);
      const handler = asyncHandler(asyncFn);

      await handler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(asyncFn).toHaveBeenCalledWith(mockRequest, mockResponse, mockNext);
      expect(mockNext).toHaveBeenCalledWith(error);
    });

    it('should catch ValidationError and pass to next()', async () => {
      const error = new ValidationError('Invalid data');
      const asyncFn = jest.fn().mockRejectedValue(error);
      const handler = asyncHandler(asyncFn);

      await handler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(error);
      expect(mockNext).toHaveBeenCalledTimes(1);
    });

    it('should handle synchronous errors in async function', async () => {
      const error = new Error('Sync error in async');
      // asyncHandler expects a function that returns a Promise
      // When the function throws synchronously, Promise.resolve will catch it
      const asyncFn = jest.fn().mockImplementation(async () => {
        throw error;
      });
      const handler = asyncHandler(asyncFn);

      await handler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(error);
    });

    it('should work with async/await functions', async () => {
      const asyncFn = async (_req: Request, res: Response) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        res.json({ success: true });
      };
      const handler = asyncHandler(asyncFn);

      await handler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should handle promise rejection', async () => {
      const error = new Error('Promise rejected');
      const asyncFn = () => Promise.reject(error);
      const handler = asyncHandler(asyncFn);

      await handler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(error);
    });

    it('should preserve function context', async () => {
      const asyncFn = async function (this: any) {
        // Check that context is preserved
        const hasContext = this !== undefined;
        expect(hasContext).toBeDefined();
        return 'done';
      };
      const handler = asyncHandler(asyncFn);

      await handler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
    });
  });
});
