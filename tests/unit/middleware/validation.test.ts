/**
 * Unit tests for validation middleware
 * Tests request validation using express-validator
 */

import { Request, Response, NextFunction } from 'express';
import { validationResult } from 'express-validator';
import { validate, createValidation } from '../../../src/middleware/validation';
import { ValidationError } from '../../../src/types';

// Mock express-validator
jest.mock('express-validator', () => ({
  validationResult: jest.fn(),
  body: jest.fn(),
  param: jest.fn(),
  query: jest.fn(),
}));

describe('Validation Middleware', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    jest.clearAllMocks();

    mockRequest = {
      body: {},
      params: {},
      query: {},
    };

    mockResponse = {};
    mockNext = jest.fn();
  });

  describe('validate', () => {
    it('should call next() when validation passes', () => {
      // Mock successful validation (no errors)
      (validationResult as unknown as jest.Mock).mockReturnValue({
        isEmpty: () => true,
        array: () => [],
      });

      validate(mockRequest as Request, mockResponse as Response, mockNext);

      expect(validationResult).toHaveBeenCalledWith(mockRequest);
      expect(mockNext).toHaveBeenCalledWith();
      expect(mockNext).toHaveBeenCalledTimes(1);
    });

    it('should throw ValidationError when validation fails', () => {
      // Mock validation errors
      (validationResult as unknown as jest.Mock).mockReturnValue({
        isEmpty: () => false,
        array: () => [
          {
            type: 'field',
            path: 'email',
            msg: 'Invalid email format',
          },
          {
            type: 'field',
            path: 'password',
            msg: 'Password is required',
          },
        ],
      });

      expect(() => {
        validate(mockRequest as Request, mockResponse as Response, mockNext);
      }).toThrow(ValidationError);

      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should format validation errors correctly', () => {
      (validationResult as unknown as jest.Mock).mockReturnValue({
        isEmpty: () => false,
        array: () => [
          {
            type: 'field',
            path: 'email',
            msg: 'Invalid email format',
          },
          {
            type: 'field',
            path: 'password',
            msg: 'Password must be at least 12 characters',
          },
        ],
      });

      try {
        validate(mockRequest as Request, mockResponse as Response, mockNext);
        fail('Should have thrown ValidationError');
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        const validationError = error as ValidationError;
        expect(validationError.message).toBe('Validation failed');
        expect(validationError.statusCode).toBe(400);
        expect(validationError.code).toBe('VALIDATION_ERROR');
        expect(validationError.details).toEqual({
          fields: {
            email: 'Invalid email format',
            password: 'Password must be at least 12 characters',
          },
        });
      }
    });

    it('should handle single validation error', () => {
      (validationResult as unknown as jest.Mock).mockReturnValue({
        isEmpty: () => false,
        array: () => [
          {
            type: 'field',
            path: 'username',
            msg: 'Username is required',
          },
        ],
      });

      try {
        validate(mockRequest as Request, mockResponse as Response, mockNext);
        fail('Should have thrown ValidationError');
      } catch (error) {
        const validationError = error as ValidationError;
        expect(validationError.details).toEqual({
          fields: {
            username: 'Username is required',
          },
        });
      }
    });

    it('should ignore non-field validation errors', () => {
      (validationResult as unknown as jest.Mock).mockReturnValue({
        isEmpty: () => false,
        array: () => [
          {
            type: 'field',
            path: 'email',
            msg: 'Invalid email',
          },
          {
            type: 'unknown_source', // Non-field error
            path: 'something',
            msg: 'Some error',
          },
        ],
      });

      try {
        validate(mockRequest as Request, mockResponse as Response, mockNext);
        fail('Should have thrown ValidationError');
      } catch (error) {
        const validationError = error as ValidationError;
        expect(validationError.details.fields).toEqual({
          email: 'Invalid email',
        });
        // Non-field error should be ignored
        expect(validationError.details.fields.something).toBeUndefined();
      }
    });

    it('should handle multiple errors for same field (keeps last one)', () => {
      (validationResult as unknown as jest.Mock).mockReturnValue({
        isEmpty: () => false,
        array: () => [
          {
            type: 'field',
            path: 'email',
            msg: 'Email is required',
          },
          {
            type: 'field',
            path: 'email',
            msg: 'Invalid email format',
          },
        ],
      });

      try {
        validate(mockRequest as Request, mockResponse as Response, mockNext);
        fail('Should have thrown ValidationError');
      } catch (error) {
        const validationError = error as ValidationError;
        // Should keep the last error message
        expect(validationError.details.fields.email).toBe('Invalid email format');
      }
    });

    it('should handle validation errors with nested field paths', () => {
      (validationResult as unknown as jest.Mock).mockReturnValue({
        isEmpty: () => false,
        array: () => [
          {
            type: 'field',
            path: 'user.email',
            msg: 'Email is invalid',
          },
          {
            type: 'field',
            path: 'user.profile.age',
            msg: 'Age must be a number',
          },
        ],
      });

      try {
        validate(mockRequest as Request, mockResponse as Response, mockNext);
        fail('Should have thrown ValidationError');
      } catch (error) {
        const validationError = error as ValidationError;
        expect(validationError.details.fields).toEqual({
          'user.email': 'Email is invalid',
          'user.profile.age': 'Age must be a number',
        });
      }
    });

    it('should not mutate request or response objects', () => {
      (validationResult as unknown as jest.Mock).mockReturnValue({
        isEmpty: () => true,
        array: () => [],
      });

      const originalBody = { test: 'data' };
      mockRequest.body = originalBody;

      validate(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockRequest.body).toBe(originalBody);
      expect(mockResponse).toEqual({});
    });

    it('should handle empty validation errors array', () => {
      (validationResult as unknown as jest.Mock).mockReturnValue({
        isEmpty: () => true,
        array: () => [],
      });

      validate(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
    });
  });

  describe('createValidation', () => {
    it('should create validation chain with validate middleware', () => {
      const mockValidation1 = jest.fn() as any;
      const mockValidation2 = jest.fn() as any;

      const chain = createValidation([mockValidation1, mockValidation2]);

      expect(chain).toHaveLength(3);
      expect(chain[0]).toBe(mockValidation1);
      expect(chain[1]).toBe(mockValidation2);
      expect(chain[2]).toBe(validate);
    });

    it('should handle single validation', () => {
      const mockValidation = jest.fn() as any;

      const chain = createValidation([mockValidation]);

      expect(chain).toHaveLength(2);
      expect(chain[0]).toBe(mockValidation);
      expect(chain[1]).toBe(validate);
    });

    it('should handle empty validation array', () => {
      const chain = createValidation([]);

      expect(chain).toHaveLength(1);
      expect(chain[0]).toBe(validate);
    });

    it('should preserve order of validations', () => {
      const validation1 = jest.fn() as any;
      const validation2 = jest.fn() as any;
      const validation3 = jest.fn() as any;

      const chain = createValidation([validation1, validation2, validation3]);

      expect(chain).toHaveLength(4);
      expect(chain[0]).toBe(validation1);
      expect(chain[1]).toBe(validation2);
      expect(chain[2]).toBe(validation3);
      expect(chain[3]).toBe(validate);
    });

    it('should return a new array (not mutate input)', () => {
      const validations = [jest.fn() as any, jest.fn() as any];
      const originalLength = validations.length;

      const chain = createValidation(validations);

      expect(validations).toHaveLength(originalLength);
      expect(chain).toHaveLength(originalLength + 1);
      expect(chain).not.toBe(validations);
    });
  });

  describe('Integration scenarios', () => {
    it('should work with typical registration validation flow', () => {
      // Simulate validation errors for registration
      (validationResult as unknown as jest.Mock).mockReturnValue({
        isEmpty: () => false,
        array: () => [
          {
            type: 'field',
            path: 'email',
            msg: 'Email is required',
          },
          {
            type: 'field',
            path: 'password',
            msg: 'Password must be at least 12 characters long',
          },
          {
            type: 'field',
            path: 'name',
            msg: 'Name is required',
          },
        ],
      });

      mockRequest.body = {
        email: '',
        password: 'short',
        name: '',
      };

      try {
        validate(mockRequest as Request, mockResponse as Response, mockNext);
        fail('Should have thrown ValidationError');
      } catch (error) {
        const validationError = error as ValidationError;
        expect(validationError.statusCode).toBe(400);
        expect(validationError.details.fields).toHaveProperty('email');
        expect(validationError.details.fields).toHaveProperty('password');
        expect(validationError.details.fields).toHaveProperty('name');
      }
    });

    it('should work with typical login validation flow', () => {
      (validationResult as unknown as jest.Mock).mockReturnValue({
        isEmpty: () => false,
        array: () => [
          {
            type: 'field',
            path: 'email',
            msg: 'Valid email is required',
          },
          {
            type: 'field',
            path: 'password',
            msg: 'Password is required',
          },
        ],
      });

      mockRequest.body = {
        email: 'invalid-email',
        password: '',
      };

      try {
        validate(mockRequest as Request, mockResponse as Response, mockNext);
        fail('Should have thrown ValidationError');
      } catch (error) {
        const validationError = error as ValidationError;
        expect(validationError.details.fields.email).toBe('Valid email is required');
        expect(validationError.details.fields.password).toBe('Password is required');
      }
    });

    it('should pass validation with correct data', () => {
      (validationResult as unknown as jest.Mock).mockReturnValue({
        isEmpty: () => true,
        array: () => [],
      });

      mockRequest.body = {
        email: 'test@example.com',
        password: 'SecurePassword123!',
      };

      validate(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
      expect(mockNext).toHaveBeenCalledTimes(1);
    });
  });
});
