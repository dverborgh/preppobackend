/**
 * Resource routes
 * Handles resource file upload, CRUD operations with authentication and validation
 */

import { Router, Request, Response, NextFunction } from 'express';
import { param, query } from 'express-validator';
import multer from 'multer';
import * as path from 'path';
import * as fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { asyncHandler } from '../middleware/errorHandler';
import { authenticate, requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { getDatabase } from '../config/database';
import * as resourceService from '../services/resourceService';
import { ProcessingStatus } from '../services/resourceService';
import { InvalidFileTypeError } from '../types';
import logger from '../utils/logger';

const router = Router();

// Get upload directory from environment or use default
const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';

// File size limits
const MAX_FILE_SIZE_PDF = 524288000; // 50MB
const MAX_FILE_SIZE_TEXT = 104857600; // 10MB

// Allowed file extensions
const ALLOWED_EXTENSIONS = ['.pdf', '.txt', '.md', '.docx'];

/**
 * Multer storage configuration
 * Stores files in temporary location before validation
 */
const storage = multer.diskStorage({
  destination: async (_req, _file, cb) => {
    try {
      // Create temporary upload directory
      const tmpDir = path.join(UPLOAD_DIR, 'tmp');
      await fs.mkdir(tmpDir, { recursive: true });
      cb(null, tmpDir);
    } catch (error: any) {
      cb(error, '');
    }
  },
  filename: (_req, file, cb) => {
    // Generate temporary filename with UUID to avoid collisions
    const uniqueName = `${uuidv4()}-${file.originalname}`;
    cb(null, uniqueName);
  },
});

/**
 * Multer file filter
 * Pre-validates file type and size before upload
 */
const fileFilter = (
  _req: any,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  const ext = path.extname(file.originalname).toLowerCase();

  // Check file extension
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    const error = new InvalidFileTypeError(
      `Invalid file type. Allowed types: ${ALLOWED_EXTENSIONS.join(', ')}`
    );
    return cb(error as any);
  }

  cb(null, true);
};

/**
 * Multer instance with configuration
 */
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE_PDF, // Use max size (will be validated per type in service)
  },
});

/**
 * Multer error handler middleware
 * Converts multer errors to appropriate HTTP responses
 */
function handleMulterError(
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      const ext = path.extname(req.file?.originalname || '').toLowerCase();
      const maxSize = ext === '.pdf' ? MAX_FILE_SIZE_PDF : MAX_FILE_SIZE_TEXT;
      const maxSizeMB = maxSize / (1024 * 1024);
      return res.status(413).json({
        error: `File size exceeds limit. Maximum size: ${maxSizeMB}MB`,
        code: 'FILE_SIZE_LIMIT_EXCEEDED',
      });
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({
        error: 'Unexpected file field',
        code: 'INVALID_FILE_FIELD',
      });
    }
    return res.status(400).json({
      error: err.message,
      code: 'FILE_UPLOAD_ERROR',
    });
  }
  return next(err);
}

// All resource routes require authentication
router.use(authenticate);

/**
 * Validation middleware for campaign ID
 */
const validateCampaignId = [
  param('campaignId').isUUID().withMessage('Campaign ID must be a valid UUID'),
];

/**
 * Validation middleware for resource ID
 */
const validateResourceId = [
  param('id').isUUID().withMessage('Resource ID must be a valid UUID'),
];

/**
 * Validation middleware for list resources
 */
const validateListResources = [
  param('campaignId').isUUID().withMessage('Campaign ID must be a valid UUID'),
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
  query('status')
    .optional()
    .isIn(['pending', 'processing', 'completed', 'failed'])
    .withMessage('Status must be one of: pending, processing, completed, failed'),
  query('fileType')
    .optional()
    .isString()
    .withMessage('File type must be a string'),
];

/**
 * POST /api/campaigns/:campaignId/resources
 * Upload a resource file
 */
router.post(
  '/campaigns/:campaignId/resources',
  validateCampaignId,
  validate,
  upload.single('file'),
  handleMulterError,
  asyncHandler(async (req: Request, res: Response) => {
    const user = requireAuth(req);
    const db = getDatabase();
    const { campaignId } = req.params;

    // Check if file was uploaded
    if (!req.file) {
      return res.status(400).json({
        error: 'File is required',
        code: 'FILE_REQUIRED',
      });
    }

    // Parse tags if provided
    const tags = req.body.tags ? JSON.parse(req.body.tags) : undefined;

    try {
      // Upload resource (service handles validation and file move)
      const resource = await resourceService.uploadResource(
        db,
        user.id,
        campaignId,
        req.file,
        tags
      );

      return res.status(201).json(resource);
    } catch (error: any) {
      // Clean up temporary file on error
      try {
        await fs.unlink(req.file.path);
      } catch (unlinkError) {
        logger.debug('Failed to clean up temporary file', {
          path: req.file.path,
        });
      }
      throw error;
    }
  })
);

/**
 * GET /api/campaigns/:campaignId/resources
 * List all resources for a campaign
 */
router.get(
  '/campaigns/:campaignId/resources',
  validateListResources,
  validate,
  asyncHandler(async (req: Request, res: Response) => {
    const user = requireAuth(req);
    const db = getDatabase();
    const { campaignId } = req.params;

    const filters: resourceService.ResourceFilters = {};
    if (req.query.status) {
      filters.status = req.query.status as ProcessingStatus;
    }
    if (req.query.fileType) {
      filters.fileType = req.query.fileType as string;
    }

    const pagination = {
      skip: (req.query.skip as unknown as number) || 0,
      limit: (req.query.limit as unknown as number) || 50,
    };

    const result = await resourceService.listResources(
      db,
      user.id,
      campaignId,
      filters,
      pagination
    );

    res.status(200).json(result);
  })
);

/**
 * DELETE /api/campaigns/:campaignId/resources/:id
 * Delete a resource (campaign-scoped)
 */
router.delete(
  '/campaigns/:campaignId/resources/:id',
  [
    param('campaignId').isUUID().withMessage('Campaign ID must be a valid UUID'),
    param('id').isUUID().withMessage('Resource ID must be a valid UUID'),
  ],
  validate,
  asyncHandler(async (req: Request, res: Response) => {
    const user = requireAuth(req);
    const db = getDatabase();
    const { campaignId, id } = req.params;

    await resourceService.deleteResource(db, user.id, id, campaignId);

    res.status(204).send();
  })
);

/**
 * GET /api/resources/:id
 * Get a specific resource by ID
 */
router.get(
  '/resources/:id',
  validateResourceId,
  validate,
  asyncHandler(async (req: Request, res: Response) => {
    const user = requireAuth(req);
    const db = getDatabase();
    const { id } = req.params;

    const resource = await resourceService.getResource(db, user.id, id);

    res.status(200).json(resource);
  })
);

/**
 * GET /api/resources/:id/status
 * Poll processing status for a resource
 */
router.get(
  '/resources/:id/status',
  validateResourceId,
  validate,
  asyncHandler(async (req: Request, res: Response) => {
    const user = requireAuth(req);
    const db = getDatabase();
    const { id } = req.params;

    const status = await resourceService.getProcessingStatus(db, user.id, id);

    res.status(200).json(status);
  })
);

/**
 * GET /api/resources/:id/chunks
 * List chunks for a resource (for debugging and selection)
 */
router.get(
  '/resources/:id/chunks',
  [
    param('id').isUUID().withMessage('Resource ID must be a valid UUID'),
    query('page')
      .optional()
      .isInt({ min: 1 })
      .toInt()
      .withMessage('Page must be a positive integer'),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 200 })
      .toInt()
      .withMessage('Limit must be between 1 and 200'),
    query('pageNumber')
      .optional()
      .isInt({ min: 1 })
      .toInt()
      .withMessage('Page number must be a positive integer'),
    query('search')
      .optional()
      .isString()
      .trim()
      .withMessage('Search must be a string'),
  ],
  validate,
  asyncHandler(async (req: Request, res: Response) => {
    const user = requireAuth(req);
    const db = getDatabase();
    const { id } = req.params;

    // Verify user has access to this resource
    await resourceService.getResource(db, user.id, id);

    const page = (req.query.page as unknown as number) || 1;
    const limit = (req.query.limit as unknown as number) || 50;
    const skip = (page - 1) * limit;

    // Build WHERE clause with optional filters
    let whereClause = 'resource_id = $1';
    const params: any[] = [id];

    if (req.query.pageNumber) {
      params.push(req.query.pageNumber);
      whereClause += ` AND page_number = $${params.length}`;
    }

    if (req.query.search) {
      params.push(`%${req.query.search}%`);
      whereClause += ` AND raw_text ILIKE $${params.length}`;
    }

    // Get total count
    const totalResult = await db.one<{ count: string }>(
      `SELECT COUNT(*) FROM resource_chunks WHERE ${whereClause}`,
      params
    );
    const total = parseInt(totalResult.count, 10);

    // Get chunks
    params.push(limit, skip);
    const chunks = await db.any(
      `SELECT
        id,
        chunk_index,
        raw_text,
        token_count,
        page_number,
        section_heading,
        LEFT(raw_text, 200) as content_preview,
        CASE WHEN embedding IS NOT NULL THEN true ELSE false END as has_embedding,
        tags,
        quality_score,
        created_at
       FROM resource_chunks
       WHERE ${whereClause}
       ORDER BY chunk_index
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const totalPages = Math.ceil(total / limit);

    res.status(200).json({
      chunks,
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
    });
  })
);

/**
 * GET /api/resources/:id/download
 * Download original resource file
 */
router.get(
  '/resources/:id/download',
  validateResourceId,
  validate,
  asyncHandler(async (req: Request, res: Response) => {
    const user = requireAuth(req);
    const db = getDatabase();
    const { id } = req.params;

    const fileData = await resourceService.downloadResource(db, user.id, id);

    // Set appropriate headers
    res.setHeader('Content-Type', fileData.contentType);
    res.setHeader('Content-Disposition', `inline; filename="${fileData.filename}"`);
    res.setHeader('Content-Length', fileData.size);

    // Stream file to response
    res.sendFile(fileData.filePath);
  })
);

/**
 * DELETE /api/resources/:id
 * Delete a resource
 */
router.delete(
  '/resources/:id',
  validateResourceId,
  validate,
  asyncHandler(async (req: Request, res: Response) => {
    const user = requireAuth(req);
    const db = getDatabase();
    const { id } = req.params;

    await resourceService.deleteResource(db, user.id, id);

    res.status(204).send();
  })
);

export default router;
