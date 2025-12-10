/**
 * Campaign routes
 * Handles campaign CRUD operations with authentication and validation
 */

import { Router, Request, Response } from 'express';
import { body, param, query } from 'express-validator';
import { asyncHandler } from '../middleware/errorHandler';
import { authenticate, requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { getDatabase } from '../config/database';
import * as campaignService from '../services/campaignService';
import sessionRoutes from './sessions';

const router = Router();

// All campaign routes require authentication
router.use(authenticate);

/**
 * Validation middleware for creating a campaign
 */
const validateCreateCampaign = [
  body('name')
    .isString()
    .trim()
    .isLength({ min: 1, max: 255 })
    .withMessage('Name is required and must be 1-255 characters'),
  body('system_name')
    .isString()
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('System name is required and must be 1-100 characters'),
  body('description')
    .optional()
    .isString()
    .trim()
    .isLength({ max: 10000 })
    .withMessage('Description must be at most 10000 characters'),
  body('metadata')
    .optional()
    .isObject()
    .withMessage('Metadata must be an object'),
];

/**
 * Validation middleware for listing campaigns
 */
const validateListCampaigns = [
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
  query('sort')
    .optional()
    .isIn(['created_at', 'name', 'updated_at'])
    .withMessage('Sort must be one of: created_at, name, updated_at'),
  query('order')
    .optional()
    .isIn(['asc', 'desc'])
    .withMessage('Order must be asc or desc'),
];

/**
 * Validation middleware for campaign ID
 */
const validateCampaignId = [
  param('id')
    .isUUID()
    .withMessage('Campaign ID must be a valid UUID'),
];

/**
 * Validation middleware for updating a campaign
 */
const validateUpdateCampaign = [
  param('id')
    .isUUID()
    .withMessage('Campaign ID must be a valid UUID'),
  body('name')
    .optional()
    .isString()
    .trim()
    .isLength({ min: 1, max: 255 })
    .withMessage('Name must be 1-255 characters'),
  body('system_name')
    .optional()
    .isString()
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('System name must be 1-100 characters'),
  body('description')
    .optional()
    .isString()
    .trim()
    .isLength({ max: 10000 })
    .withMessage('Description must be at most 10000 characters'),
  body('metadata')
    .optional()
    .isObject()
    .withMessage('Metadata must be an object'),
];

/**
 * POST /api/campaigns
 * Create a new campaign
 */
router.post(
  '/',
  validateCreateCampaign,
  validate,
  asyncHandler(async (req: Request, res: Response) => {
    const user = requireAuth(req);
    const db = getDatabase();

    const campaign = await campaignService.createCampaign(db, user.id, req.body);

    res.status(201).json(campaign);
  })
);

/**
 * GET /api/campaigns
 * List all campaigns for the authenticated user
 */
router.get(
  '/',
  validateListCampaigns,
  validate,
  asyncHandler(async (req: Request, res: Response) => {
    const user = requireAuth(req);
    const db = getDatabase();

    const result = await campaignService.getCampaigns(db, user.id, {
      skip: req.query.skip as number | undefined,
      limit: req.query.limit as number | undefined,
      sort: req.query.sort as 'created_at' | 'name' | 'updated_at' | undefined,
      order: req.query.order as 'asc' | 'desc' | undefined,
    });

    res.status(200).json(result);
  })
);

/**
 * GET /api/campaigns/:id
 * Get a specific campaign with aggregated counts
 */
router.get(
  '/:id',
  validateCampaignId,
  validate,
  asyncHandler(async (req: Request, res: Response) => {
    const user = requireAuth(req);
    const db = getDatabase();

    const campaign = await campaignService.getCampaignById(db, user.id, req.params.id);

    res.status(200).json(campaign);
  })
);

/**
 * PUT /api/campaigns/:id
 * Update a campaign
 */
router.put(
  '/:id',
  validateUpdateCampaign,
  validate,
  asyncHandler(async (req: Request, res: Response) => {
    const user = requireAuth(req);
    const db = getDatabase();

    const campaign = await campaignService.updateCampaign(db, user.id, req.params.id, req.body);

    res.status(200).json(campaign);
  })
);

/**
 * DELETE /api/campaigns/:id
 * Delete a campaign
 */
router.delete(
  '/:id',
  validateCampaignId,
  validate,
  asyncHandler(async (req: Request, res: Response) => {
    const user = requireAuth(req);
    const db = getDatabase();

    await campaignService.deleteCampaign(db, user.id, req.params.id);

    res.status(204).send();
  })
);

/**
 * Nested session routes under /api/campaigns/:campaignId/sessions
 */
router.use('/:campaignId/sessions', sessionRoutes);

export default router;
