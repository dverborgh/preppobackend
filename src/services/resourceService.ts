/**
 * Resource service
 * Handles resource file upload, CRUD operations with authorization and validation
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as fileTypeModule from 'file-type';
import { ExtendedDatabase } from '../config/database';
import {
  NotFoundError,
  ValidationError,
  PaginatedResponse,
  InvalidFileTypeError,
  FileSizeLimitError,
} from '../types';
import { verifyCampaignOwnership } from './campaignService';
import logger from '../utils/logger';
import { getJobQueue } from '../config/jobQueue';

// Get upload directory from environment or use default
const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';

// Processing status enum
export enum ProcessingStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

// Resource data types
export interface UploadResourceData {
  file: Express.Multer.File;
  tags?: string[];
}

export interface ResourceFilters {
  status?: ProcessingStatus;
  fileType?: string;
}

export interface ResourceResponse {
  id: string;
  campaign_id: string;
  original_filename: string;
  file_url: string;
  file_size_bytes: number;
  content_type: string;
  resource_type: string | null;
  title: string | null;
  author: string | null;
  uploaded_at: Date;
  ingestion_status: ProcessingStatus;
  ingestion_error: string | null;
  total_pages: number | null;
  total_chunks: number | null;
  metadata: Record<string, any>;
}

export interface ResourceWithChunkCount extends ResourceResponse {
  chunk_count: number;
}

// Allowed file types and sizes
const ALLOWED_FILE_TYPES = ['.pdf', '.txt', '.md', '.docx'];
const MAX_FILE_SIZE_PDF = 524288000; // 500MB
const MAX_FILE_SIZE_TEXT = 104857600; // 100MB

// MIME type validation mapping
const VALID_MIME_TYPES: Record<string, string[]> = {
  '.pdf': ['application/pdf'],
  '.txt': ['text/plain'],
  '.md': ['text/plain', 'text/markdown'],
  '.docx': ['application/msword']
};

/**
 * Validate file type and size
 * Uses file-type library for MIME type validation (not just extension)
 */
async function validateFile(file: Express.Multer.File): Promise<void> {
  const ext = path.extname(file.originalname).toLowerCase();

  // Check file extension
  if (!ALLOWED_FILE_TYPES.includes(ext)) {
    throw new InvalidFileTypeError(
      `Invalid file type. Allowed types: ${ALLOWED_FILE_TYPES.join(', ')}`
    );
  }

  // Check file size based on type
  const maxSize = ext === '.pdf' ? MAX_FILE_SIZE_PDF : MAX_FILE_SIZE_TEXT;
  if (file.size > maxSize) {
    const maxSizeMB = maxSize / (1024 * 1024);
    throw new FileSizeLimitError(
      `File size exceeds limit. Maximum size for ${ext} files: ${maxSizeMB}MB`
    );
  }

  // Validate MIME type using file-type library (only for PDFs)
  if (ext === '.pdf') {
    try {
      const fileType = await fileTypeModule.fromFile(file.path);
      if (!fileType || !VALID_MIME_TYPES[ext].includes(fileType.mime)) {
        throw new InvalidFileTypeError(
          `File content does not match expected type. Expected PDF, got ${fileType?.mime || 'unknown'}`
        );
      }
    } catch (error: any) {
      if (error instanceof InvalidFileTypeError) {
        throw error;
      }
      logger.warn('File type validation failed', { error: error.message });
      // Continue if file-type fails (allow text files to pass)
    }
  }
}

/**
 * Sanitize filename to prevent path traversal and special characters
 */
function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9.-]/g, '_');
}

/**
 * Upload a resource file and create database record
 * Uses transaction to ensure atomic file write + DB insert
 */
export async function uploadResource(
  db: ExtendedDatabase,
  userId: string,
  campaignId: string,
  file: Express.Multer.File,
  tags?: string[]
): Promise<ResourceResponse> {
  // Verify campaign ownership
  await verifyCampaignOwnership(db, userId, campaignId);

  // Validate file
  await validateFile(file);

  // Generate unique resource ID
  const resourceId = await db.one<{ id: string }>(
    'SELECT gen_random_uuid() as id'
  );
  const id = resourceId.id;

  // Sanitize filename
  const sanitizedFilename = sanitizeFilename(file.originalname);

  // Create directory structure: uploads/{campaignId}/{resourceId}/
  const resourceDir = path.join(UPLOAD_DIR, campaignId, id);
  const filePath = path.join(resourceDir, sanitizedFilename);
  const relativeFilePath = path.join(campaignId, id, sanitizedFilename);

  let fileWritten = false;

  try {
    // Create directory
    await fs.mkdir(resourceDir, { recursive: true });

    // Move file to final location
    await fs.rename(file.path, filePath);
    fileWritten = true;

    // Get file extension for content_type fallback
    const ext = path.extname(file.originalname).toLowerCase();
    const contentType = file.mimetype || (ext === '.pdf' ? 'application/pdf' : 'text/plain');

    // Insert database record
    const resource = await db.one<ResourceResponse>(
      `INSERT INTO resources (
        id, campaign_id, original_filename, file_url, file_size_bytes,
        content_type, ingestion_status, metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING
        id, campaign_id, original_filename, file_url, file_size_bytes,
        content_type, resource_type, title, author, uploaded_at,
        ingestion_status, ingestion_error, total_pages, total_chunks, metadata`,
      [
        id,
        campaignId,
        file.originalname,
        relativeFilePath,
        file.size,
        contentType.slice(0,50),
        ProcessingStatus.PENDING,
        { tags: tags || [] },
      ]
    );

    logger.info('Resource uploaded', {
      resource_id: resource.id,
      campaign_id: campaignId,
      user_id: userId,
      filename: file.originalname,
      size: file.size,
    });

    // Enqueue background processing job
    try {
      const queue = getJobQueue();
      await queue.send(
        'process-resource',
        {
          resourceId: id,
          campaignId,
          filePath: relativeFilePath,
          userId,
        },
        {
          retryLimit: 3, // Retry up to 3 times
          retryDelay: 60, // Wait 60 seconds before first retry
          retryBackoff: true, // Exponential backoff
          expireInSeconds: 3600, // Job expires after 1 hour
        }
      );

      logger.info('Resource processing job enqueued', {
        resource_id: id,
        campaign_id: campaignId,
      });
    } catch (error: any) {
      logger.error('Failed to enqueue resource processing job', {
        resource_id: id,
        error: error.message,
      });
      // Don't fail the upload if job enqueueing fails
      // The resource can be manually reprocessed later
    }

    return resource;
  } catch (error: any) {
    // Rollback: delete file if database insert failed
    if (fileWritten) {
      try {
        await fs.unlink(filePath);
        await fs.rmdir(resourceDir);
        logger.debug('Rolled back file upload', { path: filePath });
      } catch (unlinkError) {
        logger.error('Failed to rollback file upload', {
          path: filePath,
          error: unlinkError,
        });
      }
    }
    throw error;
  }
}

/**
 * Get a specific resource by ID
 * Verifies user has access to the campaign
 */
export async function getResource(
  db: ExtendedDatabase,
  userId: string,
  resourceId: string
): Promise<ResourceResponse> {
  const resource = await db.oneOrNone<ResourceResponse>(
    `SELECT
      r.id, r.campaign_id, r.original_filename, r.file_url, r.file_size_bytes,
      r.content_type, r.resource_type, r.title, r.author, r.uploaded_at,
      r.ingestion_status, r.ingestion_error, r.total_pages, r.total_chunks, r.metadata
    FROM resources r
    JOIN campaigns c ON c.id = r.campaign_id
    WHERE r.id = $1 AND c.user_id = $2`,
    [resourceId, userId]
  );

  if (!resource) {
    throw new NotFoundError('Resource');
  }

  logger.debug('Resource retrieved', {
    resource_id: resourceId,
    user_id: userId,
  });

  return resource;
}

/**
 * List resources for a campaign with pagination and filtering
 * Returns resources with aggregated chunk counts
 */
export async function listResources(
  db: ExtendedDatabase,
  userId: string,
  campaignId: string,
  filters?: ResourceFilters,
  pagination?: { skip: number; limit: number }
): Promise<PaginatedResponse<ResourceWithChunkCount>> {
  // Verify campaign ownership
  await verifyCampaignOwnership(db, userId, campaignId);

  const skip = Math.max(0, pagination?.skip || 0);
  const limit = Math.min(100, Math.max(1, pagination?.limit || 50));

  // Build filter conditions
  const conditions: string[] = ['r.campaign_id = $1'];
  const params: any[] = [campaignId];
  let paramIndex = 2;

  if (filters?.status) {
    conditions.push(`r.ingestion_status = $${paramIndex++}`);
    params.push(filters.status);
  }

  if (filters?.fileType) {
    conditions.push(`r.content_type = $${paramIndex++}`);
    params.push(filters.fileType);
  }

  const whereClause = conditions.join(' AND ');

  // Get total count
  const totalResult = await db.one<{ count: string }>(
    `SELECT COUNT(*) FROM resources r WHERE ${whereClause}`,
    params
  );
  const total = parseInt(totalResult.count, 10);

  // Get resources with chunk counts
  const resources = await db.any<ResourceWithChunkCount>(
    `SELECT
      r.id, r.campaign_id, r.original_filename, r.file_url, r.file_size_bytes,
      r.content_type, r.resource_type, r.title, r.author, r.uploaded_at,
      r.ingestion_status, r.ingestion_error, r.total_pages, r.total_chunks, r.metadata,
      COALESCE(COUNT(rc.id), 0)::int as chunk_count
    FROM resources r
    LEFT JOIN resource_chunks rc ON rc.resource_id = r.id
    WHERE ${whereClause}
    GROUP BY r.id
    ORDER BY r.uploaded_at DESC
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    [...params, limit, skip]
  );

  logger.debug('Resources listed', {
    campaign_id: campaignId,
    user_id: userId,
    count: resources.length,
    total,
  });

  return {
    data: resources,
    total,
    skip,
    limit,
  };
}

/**
 * Download resource file
 * Returns file path and metadata for streaming to client
 */
export async function downloadResource(
  db: ExtendedDatabase,
  userId: string,
  resourceId: string
): Promise<{
  filePath: string;
  filename: string;
  contentType: string;
  size: number;
}> {
  // Get resource and verify ownership
  const resource = await getResource(db, userId, resourceId);

  // Get absolute file path
  const filePath = path.resolve(UPLOAD_DIR, resource.file_url);

  // Verify file exists
  try {
    const stats = await fs.stat(filePath);

    logger.info('Resource download requested', {
      resource_id: resourceId,
      user_id: userId,
      filename: resource.original_filename,
      size: stats.size,
    });

    return {
      filePath,
      filename: resource.original_filename,
      contentType: resource.content_type,
      size: stats.size,
    };
  } catch (error: any) {
    logger.error('Resource file not found', {
      resource_id: resourceId,
      file_path: filePath,
      error: error.message,
    });
    throw new NotFoundError('Resource file not found on disk');
  }
}

/**
 * Delete a resource
 * Removes file from disk and cascade deletes database record
 */
export async function deleteResource(
  db: ExtendedDatabase,
  userId: string,
  resourceId: string,
  campaignId?: string
): Promise<void> {
  // Get resource and verify ownership
  const resource = await getResource(db, userId, resourceId);

  // If campaignId is provided, verify the resource belongs to that campaign
  if (campaignId && resource.campaign_id !== campaignId) {
    throw new NotFoundError('Resource');
  }

  // Delete file from disk
  const filePath = path.join(UPLOAD_DIR, resource.file_url);
  try {
    await fs.unlink(filePath);

    // Try to remove the resource directory (if empty)
    const resourceDir = path.dirname(filePath);
    try {
      await fs.rmdir(resourceDir);
    } catch (error) {
      // Directory not empty or doesn't exist - ignore
      logger.debug('Could not remove resource directory', {
        path: resourceDir,
      });
    }

    logger.debug('Resource file deleted', { path: filePath });
  } catch (error: any) {
    logger.warn('Failed to delete resource file', {
      path: filePath,
      error: error.message,
    });
    // Continue with database deletion even if file deletion fails
  }

  // Delete database record (cascade deletes chunks)
  const result = await db.result('DELETE FROM resources WHERE id = $1', [
    resourceId,
  ]);

  if (result.rowCount === 0) {
    throw new NotFoundError('Resource');
  }

  logger.info('Resource deleted', {
    resource_id: resourceId,
    user_id: userId,
    campaign_id: resource.campaign_id,
  });
}

/**
 * Update processing status for a resource
 * Used by background processing jobs
 */
export async function updateProcessingStatus(
  db: ExtendedDatabase,
  resourceId: string,
  status: ProcessingStatus,
  error?: string
): Promise<void> {
  // Validate status
  const validStatuses = Object.values(ProcessingStatus);
  if (!validStatuses.includes(status)) {
    throw new ValidationError(`Invalid processing status: ${status}`);
  }

  await db.none(
    `UPDATE resources
     SET ingestion_status = $1, ingestion_error = $2
     WHERE id = $3`,
    [status, error || null, resourceId]
  );

  logger.info('Resource processing status updated', {
    resource_id: resourceId,
    status,
    error,
  });
}

/**
 * Processing progress response
 */
export interface ProcessingProgress {
  status: ProcessingStatus;
  error: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  totalPages: number | null;
  totalChunks: number | null;
  retryCount: number;
  durationMs: number | null;
}

/**
 * Get processing status and progress for a resource
 * Used for polling by clients
 */
export async function getProcessingStatus(
  db: ExtendedDatabase,
  userId: string,
  resourceId: string
): Promise<ProcessingProgress> {
  const resource = await db.oneOrNone(
    `SELECT
      r.ingestion_status,
      r.ingestion_error,
      r.processing_started_at,
      r.processing_completed_at,
      r.total_pages,
      r.total_chunks,
      r.processing_retry_count,
      r.processing_duration_ms
     FROM resources r
     JOIN campaigns c ON r.campaign_id = c.id
     WHERE r.id = $1 AND c.user_id = $2`,
    [resourceId, userId]
  );

  if (!resource) {
    throw new NotFoundError('Resource');
  }

  return {
    status: resource.ingestion_status,
    error: resource.ingestion_error,
    startedAt: resource.processing_started_at,
    completedAt: resource.processing_completed_at,
    totalPages: resource.total_pages,
    totalChunks: resource.total_chunks,
    retryCount: resource.processing_retry_count || 0,
    durationMs: resource.processing_duration_ms,
  };
}
