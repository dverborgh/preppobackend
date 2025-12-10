/**
 * Generator routes
 * Handles random content generator CRUD and execution
 */

import { Router, Request, Response } from 'express';
import { body, param, query } from 'express-validator';
import { asyncHandler } from '../middleware/errorHandler';
import { authenticate, requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { getDatabase } from '../config/database';
import * as generatorService from '../services/generatorService';
import * as generatorRollService from '../services/generatorRollService';
import * as generatorDesignerService from '../services/generatorDesignerService';

const router = Router();

// All generator routes require authentication
router.use(authenticate);

/**
 * Validation middleware for campaign ID
 */
const validateCampaignId = [
  param('campaignId')
    .isUUID()
    .withMessage('Campaign ID must be a valid UUID'),
];

/**
 * Validation middleware for generator ID
 */
const validateGeneratorId = [
  param('id')
    .isUUID()
    .withMessage('Generator ID must be a valid UUID'),
];

/**
 * Validation middleware for creating a generator
 */
const validateCreateGenerator = [
  ...validateCampaignId,
  body('name')
    .isString()
    .trim()
    .isLength({ min: 1, max: 255 })
    .withMessage('Name is required and must be 1-255 characters'),
  body('description')
    .isString()
    .trim()
    .isLength({ min: 1, max: 10000 })
    .withMessage('Description is required and must be 1-10000 characters'),
  body('mode')
    .isIn(['table', 'llm'])
    .withMessage('Mode must be either "table" or "llm"'),
  body('output_schema')
    .isObject()
    .withMessage('Output schema must be a valid JSON object'),
  body('output_example')
    .optional()
    .isObject()
    .withMessage('Output example must be a valid JSON object'),
  body('created_by_prompt')
    .optional()
    .isString()
    .withMessage('Created by prompt must be a string'),
  body('tables')
    .optional()
    .isArray()
    .withMessage('Tables must be an array'),
  body('tables.*.name')
    .optional()
    .isString()
    .trim()
    .isLength({ min: 1, max: 255 })
    .withMessage('Table name must be 1-255 characters'),
  body('tables.*.description')
    .optional()
    .isString()
    .withMessage('Table description must be a string'),
  body('tables.*.roll_method')
    .optional()
    .isIn(['weighted_random', 'sequential', 'range_based'])
    .withMessage('Roll method must be weighted_random, sequential, or range_based'),
  body('tables.*.entries')
    .optional()
    .isArray({ min: 1, max: 100 })
    .withMessage('Entries must be an array with 1-100 items'),
];

/**
 * Validation middleware for listing generators
 */
const validateListGenerators = [
  ...validateCampaignId,
  query('status')
    .optional()
    .isIn(['active', 'archived', 'testing'])
    .withMessage('Status must be one of: active, archived, testing'),
  query('skip')
    .optional()
    .isInt({ min: 0 })
    .toInt()
    .withMessage('Skip must be a non-negative integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .toInt()
    .withMessage('Limit must be between 1 and 100'),
];

/**
 * Validation middleware for updating a generator
 */
const validateUpdateGenerator = [
  ...validateCampaignId,
  ...validateGeneratorId,
  body('name')
    .optional()
    .isString()
    .trim()
    .isLength({ min: 1, max: 255 })
    .withMessage('Name must be 1-255 characters'),
  body('description')
    .optional()
    .isString()
    .trim()
    .isLength({ min: 1, max: 10000 })
    .withMessage('Description must be 1-10000 characters'),
  body('output_schema')
    .optional()
    .isObject()
    .withMessage('Output schema must be a valid JSON object'),
  body('output_example')
    .optional()
    .isObject()
    .withMessage('Output example must be a valid JSON object'),
  body('status')
    .optional()
    .isIn(['active', 'archived', 'testing'])
    .withMessage('Status must be one of: active, archived, testing'),
];

/**
 * Validation middleware for executing a roll
 */
const validateExecuteRoll = [
  ...validateCampaignId,
  ...validateGeneratorId,
  body('session_id')
    .optional({ nullable: true })
    .isUUID()
    .withMessage('Session ID must be a valid UUID'),
  body('seed')
    .optional({ nullable: true })
    .isString()
    .withMessage('Seed must be a string'),
  body('test_mode')
    .optional({ nullable: true })
    .isBoolean()
    .withMessage('Test mode must be a boolean'),
];

/**
 * Validation middleware for listing rolls
 */
const validateListRolls = [
  ...validateCampaignId,
  ...validateGeneratorId,
  query('sessionId')
    .optional()
    .isUUID()
    .withMessage('Session ID must be a valid UUID'),
  query('skip')
    .optional()
    .isInt({ min: 0 })
    .toInt()
    .withMessage('Skip must be a non-negative integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .toInt()
    .withMessage('Limit must be between 1 and 100'),
];

/**
 * POST /api/campaigns/:campaignId/generators/design
 * Design and create a generator from natural language
 */
router.post(
  '/campaigns/:campaignId/generators/design',
  [
    ...validateCampaignId,
    //...validateSessionId,
    body('natural_language_spec')
      .isString()
      .trim()
      .isLength({ min: 1, max: 2000 })
      .withMessage('Natural language specification is required and must be 1-2000 characters'),
    body('system_name')
      .optional()
      .isString()
      .trim()
      .isLength({ max: 100 })
      .withMessage('System name must not exceed 100 characters'),
  ],
  validate,
  asyncHandler(async (req: Request, res: Response) => {
    const user = requireAuth(req);
    const db = getDatabase();
    const { campaignId } = req.params;
    const sessionId = req.body.session_id || undefined

    const generator = await generatorDesignerService.designAndCreateGenerator(
      db,
      user.id,
      campaignId,
      sessionId,
      req.body
    );

    res.status(201).json(generator);
  })
);

/**
 * POST /api/campaigns/:campaignId/generators
 * Create a new generator manually (pre-defined structure)
 */
router.post(
  '/campaigns/:campaignId/generators',
  validateCreateGenerator,
  validate,
  asyncHandler(async (req: Request, res: Response) => {
    const user = requireAuth(req);
    const db = getDatabase();
    const { campaignId } = req.params;

    const generator = await generatorService.createGenerator(
      db,
      user.id,
      campaignId,
      undefined,
      req.body
    );

    res.status(201).json(generator);
  })
);

/**
 * GET /api/campaigns/:campaignId/generators
 * List all generators for a campaign
 */
router.get(
  '/campaigns/:campaignId/generators',
  validateListGenerators,
  validate,
  asyncHandler(async (req: Request, res: Response) => {
    const user = requireAuth(req);
    const db = getDatabase();
    const { campaignId } = req.params;

    const options = {
      status: req.query.status as 'active' | 'archived' | 'testing' | undefined,
      skip: req.query.skip ? parseInt(req.query.skip as string, 10) : undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
    };

    const result = await generatorService.listGenerators(
      db,
      user.id,
      campaignId,
      options
    );

    res.status(200).json(result);
  })
);

/**
 * GET /api/campaigns/:campaignId/generators/:id
 * Get a specific generator with full table structure
 */
router.get(
  '/campaigns/:campaignId/generators/:id',
  [...validateCampaignId, ...validateGeneratorId],
  validate,
  asyncHandler(async (req: Request, res: Response) => {
    const user = requireAuth(req);
    const db = getDatabase();
    const { campaignId, id } = req.params;

    const generator = await generatorService.getGenerator(
      db,
      user.id,
      campaignId,
      id
    );

    res.status(200).json(generator);
  })
);

/**
 * PUT /api/campaigns/:campaignId/generators/:id
 * Update a generator
 */
router.put(
  '/campaigns/:campaignId/generators/:id',
  validateUpdateGenerator,
  validate,
  asyncHandler(async (req: Request, res: Response) => {
    const user = requireAuth(req);
    const db = getDatabase();
    const { campaignId, id } = req.params;

    const generator = await generatorService.updateGenerator(
      db,
      user.id,
      campaignId,
      id,
      req.body
    );

    res.status(200).json(generator);
  })
);

/**
 * DELETE /api/campaigns/:campaignId/generators/:id
 * Delete a generator
 */
router.delete(
  '/campaigns/:campaignId/generators/:id',
  [...validateCampaignId, ...validateGeneratorId],
  validate,
  asyncHandler(async (req: Request, res: Response) => {
    const user = requireAuth(req);
    const db = getDatabase();
    const { campaignId, id } = req.params;

    await generatorService.deleteGenerator(
      db,
      user.id,
      campaignId,
      id
    );

    res.status(204).send();
  })
);

/**
 * POST /api/campaigns/:campaignId/generators/:id/roll
 * Execute a generator roll
 * CRITICAL: Must complete in < 300ms (p95) - NO LLM CALLS
 */
router.post(
  '/campaigns/:campaignId/generators/:id/roll',
  validateExecuteRoll,
  validate,
  asyncHandler(async (req: Request, res: Response) => {
    const user = requireAuth(req);
    const db = getDatabase();
    const { campaignId, id } = req.params;

    const result = await generatorRollService.executeRoll(
      db,
      user.id,
      campaignId,
      id,
      req.body
    );

    res.status(200).json(result);
  })
);

/**
 * GET /api/campaigns/:campaignId/generators/:id/rolls
 * Get roll history for a generator
 */
router.get(
  '/campaigns/:campaignId/generators/:id/rolls',
  validateListRolls,
  validate,
  asyncHandler(async (req: Request, res: Response) => {
    const user = requireAuth(req);
    const db = getDatabase();
    const { campaignId, id } = req.params;

    const options = {
      sessionId: req.query.sessionId as string | undefined,
      skip: req.query.skip ? parseInt(req.query.skip as string, 10) : undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
    };

    const result = await generatorRollService.getRollHistory(
      db,
      user.id,
      campaignId,
      id,
      options
    );

    res.status(200).json(result);
  })
);

/**
 * GET /api/campaigns/:campaignId/generators/:id/statistics
 * Get roll statistics for a generator
 */
router.get(
  '/campaigns/:campaignId/generators/:id/statistics',
  [...validateCampaignId, ...validateGeneratorId],
  validate,
  asyncHandler(async (req: Request, res: Response) => {
    const user = requireAuth(req);
    const db = getDatabase();
    const { campaignId, id } = req.params;
    const sessionId = req.query.sessionId as string | undefined;

    const statistics = await generatorRollService.getRollStatistics(
      db,
      user.id,
      campaignId,
      id,
      sessionId
    );

    res.status(200).json(statistics);
  })
);

export default router;
