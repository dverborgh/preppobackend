/**
 * Request validation middleware
 * Uses express-validator for input validation
 */

import { Request, Response, NextFunction } from 'express';
import { validationResult, ValidationChain } from 'express-validator';
import { ValidationError } from '../types';

/**
 * Validate request and throw error if validation fails
 */
export function validate(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    const formattedErrors = errors.array().reduce((acc: Record<string, string>, err) => {
      if (err.type === 'field') {
        acc[err.path] = err.msg;
      }
      return acc;
    }, {});

    throw new ValidationError('Validation failed', {
      fields: formattedErrors,
    });
  }

  next();
}

/**
 * Create validation middleware chain
 */
export function createValidation(
  validations: ValidationChain[]
): Array<ValidationChain | typeof validate> {
  return [...validations, validate];
}
