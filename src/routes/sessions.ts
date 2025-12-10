/**
 * Session routes
 * Handles game session CRUD operations with authentication and validation
 */

import { Router, Request, Response } from 'express';
import { body, param, query } from 'express-validator';
import { asyncHandler } from '../middleware/errorHandler';
import { authenticate, requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { getDatabase } from '../config/database';
import * as sessionService from '../services/sessionService';

const router = Router({ mergeParams: true });

// All session routes require authentication
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
 * Validation middleware for session ID
 */
const validateSessionId = [
  param('id')
    .isUUID()
    .withMessage('Session ID must be a valid UUID'),
];

/**
 * Validation middleware for creating a session
 */
const validateCreateSession = [
  ...validateCampaignId,
  body('session_number')
    .isInt({ min: 1 })
    .withMessage('Session number must be a positive integer'),
  body('name')
    .isString()
    .trim()
    .isLength({ min: 1, max: 255 })
    .withMessage('Name is required and must be 1-255 characters'),
  body('scheduled_date')
    .optional()
    .isISO8601()
    .toDate()
    .withMessage('Scheduled date must be a valid ISO 8601 date'),
  body('description')
    .optional()
    .isString()
    .trim()
    .isLength({ max: 10000 })
    .withMessage('Description must be at most 10000 characters'),
  body('preparation_notes')
    .optional()
    .isString()
    .trim()
    .isLength({ max: 10000 })
    .withMessage('Preparation notes must be at most 10000 characters'),
  body('gm_objectives')
    .optional()
    .isArray()
    .withMessage('GM objectives must be an array'),
  body('gm_objectives.*')
    .optional()
    .isString()
    .withMessage('Each GM objective must be a string'),
  body('notes')
    .optional()
    .isString()
    .trim()
    .isLength({ max: 10000 })
    .withMessage('Notes must be at most 10000 characters'),
  body('duration_minutes')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Duration minutes must be a non-negative integer'),
];

/**
 * Validation middleware for listing sessions
 */
const validateListSessions = [
  ...validateCampaignId,
  query('status')
    .optional()
    .isIn(['draft', 'planned', 'in-progress', 'completed'])
    .withMessage('Status must be one of: draft, planned, in-progress, completed'),
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
 * Validation middleware for updating a session
 */
const validateUpdateSession = [
  ...validateCampaignId,
  ...validateSessionId,
  body('name')
    .optional()
    .isString()
    .trim()
    .isLength({ min: 1, max: 255 })
    .withMessage('Name must be 1-255 characters'),
  body('session_number')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Session number must be a positive integer'),
  body('scheduled_date')
    .optional({ nullable: true })
    .custom((value) => value === null || typeof value === 'string')
    .withMessage('Scheduled date must be a string or null'),
  body('description')
    .optional({ nullable: true })
    .custom((value) => value === null || typeof value === 'string')
    .withMessage('Description must be a string or null'),
  body('notes')
    .optional({ nullable: true })
    .custom((value) => value === null || typeof value === 'string')
    .withMessage('Notes must be a string or null'),
  body('duration_minutes')
    .optional({ nullable: true })
    .custom((value) => value === null || (Number.isInteger(value) && value >= 0))
    .withMessage('Duration minutes must be a non-negative integer or null'),
  body('status')
    .optional()
    .isIn(['draft', 'planned', 'in-progress', 'completed'])
    .withMessage('Status must be one of: draft, planned, in-progress, completed'),
  body('preparation_notes')
    .optional({ nullable: true })
    .custom((value) => value === null || typeof value === 'string')
    .withMessage('Preparation notes must be a string or null'),
  body('gm_objectives')
    .optional()
    .isArray()
    .withMessage('GM objectives must be an array'),
  body('gm_objectives.*')
    .optional()
    .isString()
    .withMessage('Each GM objective must be a string'),
];

/**
 * POST /api/campaigns/:campaignId/sessions
 * Create a new session
 */
router.post(
  '/',
  validateCreateSession,
  validate,
  asyncHandler(async (req: Request, res: Response) => {
    const user = requireAuth(req);
    const db = getDatabase();
    const { campaignId } = req.params;

    const session = await sessionService.createSession(
      db,
      user.id,
      campaignId,
      req.body
    );

    res.status(201).json(session);
  })
);

/**
 * GET /api/campaigns/:campaignId/sessions
 * List all sessions for a campaign
 */
router.get(
  '/',
  validateListSessions,
  validate,
  asyncHandler(async (req: Request, res: Response) => {
    const user = requireAuth(req);
    const db = getDatabase();
    const { campaignId } = req.params;

    const options = {
      status: req.query.status as 'draft' | 'planned' | 'in-progress' | 'completed' | undefined,
      skip: req.query.skip ? parseInt(req.query.skip as string, 10) : undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
    };

    const result = await sessionService.getSessions(
      db,
      user.id,
      campaignId,
      options
    );

    res.status(200).json(result);
  })
);

/**
 * GET /api/campaigns/:campaignId/sessions/:id
 * Get a specific session
 */
router.get(
  '/:id',
  [...validateCampaignId, ...validateSessionId],
  validate,
  asyncHandler(async (req: Request, res: Response) => {
    const user = requireAuth(req);
    const db = getDatabase();
    const { campaignId, id } = req.params;

    const session = await sessionService.getSessionById(
      db,
      user.id,
      campaignId,
      id
    );

    res.status(200).json(session);
  })
);

/**
 * PUT /api/campaigns/:campaignId/sessions/:id
 * Update a session
 */
router.put(
  '/:id',
  validateUpdateSession,
  validate,
  asyncHandler(async (req: Request, res: Response) => {
    const user = requireAuth(req);
    const db = getDatabase();
    const { campaignId, id } = req.params;

    const session = await sessionService.updateSession(
      db,
      user.id,
      campaignId,
      id,
      req.body
    );

    res.status(200).json(session);
  })
);

/**
 * DELETE /api/campaigns/:campaignId/sessions/:id
 * Delete a session
 */
router.delete(
  '/:id',
  [...validateCampaignId, ...validateSessionId],
  validate,
  asyncHandler(async (req: Request, res: Response) => {
    const user = requireAuth(req);
    const db = getDatabase();
    const { campaignId, id } = req.params;

    await sessionService.deleteSession(
      db,
      user.id,
      campaignId,
      id
    );

    res.status(204).send();
  })
);

/**
 * POST /api/campaigns/:campaignId/sessions/:id/activate
 * Activate a session for use in Session Console
 */
router.post(
  '/:id/activate',
  [...validateCampaignId, ...validateSessionId],
  validate,
  asyncHandler(async (req: Request, res: Response) => {
    const user = requireAuth(req);
    const db = getDatabase();
    const { campaignId, id } = req.params;

    const session = await sessionService.activateSession(
      db,
      user.id,
      campaignId,
      id
    );

    res.status(200).json(session);
  })
);

/**
 * POST /api/campaigns/:campaignId/sessions/:id/deactivate
 * Deactivate a session (remove from Session Console)
 */
router.post(
  '/:id/deactivate',
  [...validateCampaignId, ...validateSessionId],
  validate,
  asyncHandler(async (req: Request, res: Response) => {
    const user = requireAuth(req);
    const db = getDatabase();
    const { campaignId, id } = req.params;

    const session = await sessionService.deactivateSession(
      db,
      user.id,
      campaignId,
      id
    );

    res.status(200).json(session);
  })
);

export default router;
