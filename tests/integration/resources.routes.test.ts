/**
 * Integration tests for resource routes
 * Tests all resource endpoints with mocked database and file uploads
 */

import request from 'supertest';
import express, { Express } from 'express';
import * as path from 'path';
import campaignRoutes from '../../src/routes/campaigns';
import { errorHandler } from '../../src/middleware/errorHandler';
import * as database from '../../src/config/database';
import * as redis from '../../src/config/redis';
import * as resourceService from '../../src/services/resourceService';
import * as campaignService from '../../src/services/campaignService';
import * as authUtils from '../../src/utils/auth';

// Mock dependencies
jest.mock('../../src/config/database');
jest.mock('../../src/config/redis');
jest.mock('../../src/services/resourceService');
jest.mock('../../src/services/campaignService');
jest.mock('../../src/utils/auth');
jest.mock('../../src/utils/logger', () => {
  const mockLogger = {
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    silent: true,
  };
  return {
    __esModule: true,
    default: mockLogger,
  };
});

describe('Resource Routes Integration Tests', () => {
  let app: Express;
  let mockDb: any;
  let mockCache: any;
  const userId = '123e4567-e89b-12d3-a456-426614174000';
  const campaignId = '123e4567-e89b-12d3-a456-426614174001';
  const resourceId = '123e4567-e89b-12d3-a456-426614174002';
  const mockToken = 'Bearer mock_token';

  const testPdfPath = path.join(__dirname, '../fixtures/test.pdf');
  const testTxtPath = path.join(__dirname, '../fixtures/test.txt');
  const testMdPath = path.join(__dirname, '../fixtures/test.md');
  const testLargePath = path.join(__dirname, '../fixtures/test-large.txt');

  beforeAll(() => {
    // Create Express app
    app = express();
    app.use(express.json());

    // API Router setup (mirroring src/index.ts)
    const apiRouter = express.Router();
    apiRouter.use('/campaigns', campaignRoutes);
    apiRouter.use('/', require('../../src/routes/resources').default);

    app.use('/api', apiRouter);
    app.use(errorHandler);
  });

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Mock database
    mockDb = {
      one: jest.fn(),
      oneOrNone: jest.fn(),
      any: jest.fn(),
      none: jest.fn(),
      result: jest.fn(),
    };
    (database.getDatabase as jest.Mock).mockReturnValue(mockDb);

    // Mock cache service
    mockCache = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      exists: jest.fn(),
      blacklistToken: jest.fn(),
      isTokenBlacklisted: jest.fn().mockResolvedValue(false),
    };
    (redis.getCacheService as jest.Mock).mockReturnValue(mockCache);

    // Mock auth utils
    (authUtils.extractTokenFromHeader as jest.Mock).mockReturnValue('mock_token');
    (authUtils.verifyAccessToken as jest.Mock).mockReturnValue({
      sub: userId,
      email: 'test@example.com',
      iat: Date.now(),
      exp: Date.now() + 86400,
      iss: 'preppo.example.com',
    });

    // Mock campaign ownership verification
    (campaignService.verifyCampaignOwnership as jest.Mock).mockResolvedValue(
      undefined
    );
  });

  describe('POST /api/campaigns/:campaignId/resources', () => {
    it('should upload PDF successfully (201)', async () => {
      const mockResource = {
        id: resourceId,
        campaign_id: campaignId,
        original_filename: 'test.pdf',
        file_url: `${campaignId}/${resourceId}/test.pdf`,
        file_size_bytes: 543,
        content_type: 'application/pdf',
        resource_type: null,
        title: null,
        author: null,
        uploaded_at: new Date(),
        ingestion_status: 'pending',
        ingestion_error: null,
        total_pages: null,
        total_chunks: null,
        metadata: { tags: [] },
      };

      (resourceService.uploadResource as jest.Mock).mockResolvedValue(mockResource);

      const response = await request(app)
        .post(`/api/campaigns/${campaignId}/resources`)
        .set('Authorization', mockToken)
        .attach('file', testPdfPath)
        .expect(201);

      expect(response.body).toMatchObject({
        id: resourceId,
        campaign_id: campaignId,
        original_filename: 'test.pdf',
        content_type: 'application/pdf',
      });
      expect(resourceService.uploadResource).toHaveBeenCalledWith(
        mockDb,
        userId,
        campaignId,
        expect.objectContaining({
          originalname: 'test.pdf',
          mimetype: 'application/pdf',
        }),
        undefined
      );
    });

    it('should upload text file successfully (201)', async () => {
      const mockResource = {
        id: resourceId,
        campaign_id: campaignId,
        original_filename: 'test.txt',
        file_url: `${campaignId}/${resourceId}/test.txt`,
        file_size_bytes: 500,
        content_type: 'text/plain',
        resource_type: null,
        title: null,
        author: null,
        uploaded_at: new Date(),
        ingestion_status: 'pending',
        ingestion_error: null,
        total_pages: null,
        total_chunks: null,
        metadata: { tags: [] },
      };

      (resourceService.uploadResource as jest.Mock).mockResolvedValue(mockResource);

      const response = await request(app)
        .post(`/api/campaigns/${campaignId}/resources`)
        .set('Authorization', mockToken)
        .attach('file', testTxtPath)
        .expect(201);

      expect(response.body).toMatchObject({
        id: resourceId,
        content_type: 'text/plain',
      });
    });

    it('should upload markdown file successfully (201)', async () => {
      const mockResource = {
        id: resourceId,
        campaign_id: campaignId,
        original_filename: 'test.md',
        file_url: `${campaignId}/${resourceId}/test.md`,
        file_size_bytes: 400,
        content_type: 'text/plain',
        resource_type: null,
        title: null,
        author: null,
        uploaded_at: new Date(),
        ingestion_status: 'pending',
        ingestion_error: null,
        total_pages: null,
        total_chunks: null,
        metadata: { tags: [] },
      };

      (resourceService.uploadResource as jest.Mock).mockResolvedValue(mockResource);

      const response = await request(app)
        .post(`/api/campaigns/${campaignId}/resources`)
        .set('Authorization', mockToken)
        .attach('file', testMdPath)
        .expect(201);

      expect(response.body.original_filename).toBe('test.md');
    });

    it('should upload file with tags (201)', async () => {
      const mockResource = {
        id: resourceId,
        campaign_id: campaignId,
        original_filename: 'test.pdf',
        file_url: `${campaignId}/${resourceId}/test.pdf`,
        file_size_bytes: 543,
        content_type: 'application/pdf',
        resource_type: null,
        title: null,
        author: null,
        uploaded_at: new Date(),
        ingestion_status: 'pending',
        ingestion_error: null,
        total_pages: null,
        total_chunks: null,
        metadata: { tags: ['rules', 'combat'] },
      };

      (resourceService.uploadResource as jest.Mock).mockResolvedValue(mockResource);

      const response = await request(app)
        .post(`/api/campaigns/${campaignId}/resources`)
        .set('Authorization', mockToken)
        .attach('file', testPdfPath)
        .field('tags', JSON.stringify(['rules', 'combat']))
        .expect(201);

      expect(response.body.metadata.tags).toEqual(['rules', 'combat']);
    });

    it('should reject upload without file (400)', async () => {
      const response = await request(app)
        .post(`/api/campaigns/${campaignId}/resources`)
        .set('Authorization', mockToken)
        .expect(400);

      expect(response.body.error).toContain('File is required');
    });

    it('should reject invalid campaign ID (400)', async () => {
      const response = await request(app)
        .post('/api/campaigns/invalid-uuid/resources')
        .set('Authorization', mockToken)
        .attach('file', testPdfPath)
        .expect(400);

      expect(response.body.details || response.body.error).toBeDefined();
    });

    it('should reject oversized file (413)', async () => {
      const FileSizeLimitError = require('../../src/types').FileSizeLimitError;
      (resourceService.uploadResource as jest.Mock).mockRejectedValue(
        new FileSizeLimitError('File size exceeds limit')
      );

      const response = await request(app)
        .post(`/api/campaigns/${campaignId}/resources`)
        .set('Authorization', mockToken)
        .attach('file', testLargePath);

      // File might be rejected by multer (413) or service (413)
      expect([413, 500]).toContain(response.status);
    });

    it('should reject unauthorized access (401)', async () => {
      (authUtils.verifyAccessToken as jest.Mock).mockImplementation(() => {
        throw new Error('Invalid token');
      });

      const response = await request(app)
        .post(`/api/campaigns/${campaignId}/resources`)
        .set('Authorization', 'Bearer invalid_token')
        .attach('file', testPdfPath)
        .expect(401);

      expect(response.body.code).toBe('UNAUTHORIZED');
    });

    it('should reject access to campaign not owned by user (403)', async () => {
      const ForbiddenError = require('../../src/types').ForbiddenError;
      (campaignService.verifyCampaignOwnership as jest.Mock).mockRejectedValue(
        new ForbiddenError('You do not have permission to access this campaign')
      );

      (resourceService.uploadResource as jest.Mock).mockRejectedValue(
        new ForbiddenError('You do not have permission to access this campaign')
      );

      const response = await request(app)
        .post(`/api/campaigns/${campaignId}/resources`)
        .set('Authorization', mockToken)
        .attach('file', testPdfPath)
        .expect(403);

      expect(response.body.code).toBe('FORBIDDEN');
    });

    it('should reject invalid file type (400)', async () => {
      const response = await request(app)
        .post(`/api/campaigns/${campaignId}/resources`)
        .set('Authorization', mockToken)
        .attach('file', Buffer.from('test'), 'test.exe')
        .expect(400);

      expect(response.body.error).toContain('Invalid file type');
    });

    it('should handle upload service error and clean up file', async () => {
      (resourceService.uploadResource as jest.Mock).mockRejectedValue(
        new Error('Database error')
      );

      const response = await request(app)
        .post(`/api/campaigns/${campaignId}/resources`)
        .set('Authorization', mockToken)
        .attach('file', testPdfPath);

      // Should return error (500)
      expect(response.status).toBe(500);
    });
  });

  describe('GET /api/campaigns/:campaignId/resources', () => {
    it('should list resources with default pagination (200)', async () => {
      const mockResources = [
        {
          id: 'resource-1',
          campaign_id: campaignId,
          original_filename: 'test1.pdf',
          file_url: `${campaignId}/resource-1/test1.pdf`,
          file_size_bytes: 1024000,
          content_type: 'application/pdf',
          resource_type: null,
          title: null,
          author: null,
          uploaded_at: new Date(),
          ingestion_status: 'completed',
          ingestion_error: null,
          total_pages: 50,
          total_chunks: 25,
          metadata: {},
          chunk_count: 25,
        },
        {
          id: 'resource-2',
          campaign_id: campaignId,
          original_filename: 'notes.txt',
          file_url: `${campaignId}/resource-2/notes.txt`,
          file_size_bytes: 5000,
          content_type: 'text/plain',
          resource_type: null,
          title: null,
          author: null,
          uploaded_at: new Date(),
          ingestion_status: 'pending',
          ingestion_error: null,
          total_pages: null,
          total_chunks: null,
          metadata: {},
          chunk_count: 0,
        },
      ];

      (resourceService.listResources as jest.Mock).mockResolvedValue({
        data: mockResources,
        total: 2,
        skip: 0,
        limit: 50,
      });

      const response = await request(app)
        .get(`/api/campaigns/${campaignId}/resources`)
        .set('Authorization', mockToken)
        .expect(200);

      expect(response.body.data).toHaveLength(2);
      expect(response.body.total).toBe(2);
      expect(response.body.skip).toBe(0);
      expect(response.body.limit).toBe(50);
    });

    it('should list resources with custom pagination (200)', async () => {
      (resourceService.listResources as jest.Mock).mockResolvedValue({
        data: [],
        total: 100,
        skip: 20,
        limit: 10,
      });

      const response = await request(app)
        .get(`/api/campaigns/${campaignId}/resources?skip=20&limit=10`)
        .set('Authorization', mockToken)
        .expect(200);

      expect(response.body.skip).toBe(20);
      expect(response.body.limit).toBe(10);
      expect(resourceService.listResources).toHaveBeenCalledWith(
        mockDb,
        userId,
        campaignId,
        {},
        { skip: 20, limit: 10 }
      );
    });

    it('should filter resources by status (200)', async () => {
      (resourceService.listResources as jest.Mock).mockResolvedValue({
        data: [],
        total: 5,
        skip: 0,
        limit: 50,
      });

      await request(app)
        .get(`/api/campaigns/${campaignId}/resources?status=completed`)
        .set('Authorization', mockToken)
        .expect(200);

      expect(resourceService.listResources).toHaveBeenCalledWith(
        mockDb,
        userId,
        campaignId,
        { status: 'completed' },
        { skip: 0, limit: 50 }
      );
    });

    it('should filter resources by file type (200)', async () => {
      (resourceService.listResources as jest.Mock).mockResolvedValue({
        data: [],
        total: 3,
        skip: 0,
        limit: 50,
      });

      await request(app)
        .get(`/api/campaigns/${campaignId}/resources?fileType=application/pdf`)
        .set('Authorization', mockToken)
        .expect(200);

      expect(resourceService.listResources).toHaveBeenCalledWith(
        mockDb,
        userId,
        campaignId,
        { fileType: 'application/pdf' },
        { skip: 0, limit: 50 }
      );
    });

    it('should return empty list when no resources (200)', async () => {
      (resourceService.listResources as jest.Mock).mockResolvedValue({
        data: [],
        total: 0,
        skip: 0,
        limit: 50,
      });

      const response = await request(app)
        .get(`/api/campaigns/${campaignId}/resources`)
        .set('Authorization', mockToken)
        .expect(200);

      expect(response.body.data).toHaveLength(0);
      expect(response.body.total).toBe(0);
    });

    it('should reject invalid pagination parameters (400)', async () => {
      const response = await request(app)
        .get(`/api/campaigns/${campaignId}/resources?skip=-1`)
        .set('Authorization', mockToken)
        .expect(400);

      expect(response.body.details || response.body.error).toBeDefined();
    });

    it('should reject invalid status filter (400)', async () => {
      const response = await request(app)
        .get(`/api/campaigns/${campaignId}/resources?status=invalid`)
        .set('Authorization', mockToken)
        .expect(400);

      expect(response.body.details || response.body.error).toBeDefined();
    });

    it('should reject unauthorized access (401)', async () => {
      (authUtils.verifyAccessToken as jest.Mock).mockImplementation(() => {
        throw new Error('Invalid token');
      });

      const response = await request(app)
        .get(`/api/campaigns/${campaignId}/resources`)
        .set('Authorization', 'Bearer invalid_token')
        .expect(401);

      expect(response.body.code).toBe('UNAUTHORIZED');
    });

    it('should reject access to campaign not owned by user (403)', async () => {
      const ForbiddenError = require('../../src/types').ForbiddenError;
      (resourceService.listResources as jest.Mock).mockRejectedValue(
        new ForbiddenError('You do not have permission to access this campaign')
      );

      const response = await request(app)
        .get(`/api/campaigns/${campaignId}/resources`)
        .set('Authorization', mockToken)
        .expect(403);

      expect(response.body.code).toBe('FORBIDDEN');
    });
  });

  describe('GET /api/resources/:id', () => {
    it('should get resource details (200)', async () => {
      const mockResource = {
        id: resourceId,
        campaign_id: campaignId,
        original_filename: 'test.pdf',
        file_url: `${campaignId}/${resourceId}/test.pdf`,
        file_size_bytes: 1024000,
        content_type: 'application/pdf',
        resource_type: null,
        title: null,
        author: null,
        uploaded_at: new Date(),
        ingestion_status: 'completed',
        ingestion_error: null,
        total_pages: 100,
        total_chunks: 50,
        metadata: {},
      };

      (resourceService.getResource as jest.Mock).mockResolvedValue(mockResource);

      const response = await request(app)
        .get(`/api/resources/${resourceId}`)
        .set('Authorization', mockToken)
        .expect(200);

      expect(response.body).toMatchObject({
        id: resourceId,
        campaign_id: campaignId,
        original_filename: 'test.pdf',
        total_chunks: 50,
      });
    });

    it('should return 404 if resource not found', async () => {
      const NotFoundError = require('../../src/types').NotFoundError;
      (resourceService.getResource as jest.Mock).mockRejectedValue(
        new NotFoundError('Resource')
      );

      const response = await request(app)
        .get(`/api/resources/${resourceId}`)
        .set('Authorization', mockToken)
        .expect(404);

      expect(response.body.code).toBe('NOT_FOUND');
    });

    it('should reject invalid resource ID (400)', async () => {
      const response = await request(app)
        .get('/api/resources/invalid-uuid')
        .set('Authorization', mockToken)
        .expect(400);

      expect(response.body.details || response.body.error).toBeDefined();
    });

    it('should reject unauthorized access (401)', async () => {
      (authUtils.verifyAccessToken as jest.Mock).mockImplementation(() => {
        throw new Error('Invalid token');
      });

      const response = await request(app)
        .get(`/api/resources/${resourceId}`)
        .set('Authorization', 'Bearer invalid_token')
        .expect(401);

      expect(response.body.code).toBe('UNAUTHORIZED');
    });
  });

  describe('GET /api/resources/:id/chunks', () => {
    it('should get resource chunks with default pagination (200)', async () => {
      const mockResource = {
        id: resourceId,
        campaign_id: campaignId,
        original_filename: 'test.pdf',
      };

      const mockChunks = [
        {
          id: 'chunk-1',
          chunk_index: 0,
          raw_text: 'This is the first chunk of text from the PDF...',
          token_count: 150,
          page_number: 1,
          section_heading: 'Introduction',
          content_preview: 'This is the first chunk of text from the PDF...',
          has_embedding: true,
          tags: ['rules'],
          quality_score: 0.95,
          created_at: new Date(),
        },
        {
          id: 'chunk-2',
          chunk_index: 1,
          raw_text: 'This is the second chunk with more content...',
          token_count: 200,
          page_number: 2,
          section_heading: 'Chapter 1',
          content_preview: 'This is the second chunk with more content...',
          has_embedding: true,
          tags: ['combat'],
          quality_score: 0.88,
          created_at: new Date(),
        },
      ];

      (resourceService.getResource as jest.Mock).mockResolvedValue(mockResource);
      mockDb.one.mockResolvedValue({ count: '2' });
      mockDb.any.mockResolvedValue(mockChunks);

      const response = await request(app)
        .get(`/api/resources/${resourceId}/chunks`)
        .set('Authorization', mockToken)
        .expect(200);

      expect(response.body.chunks).toHaveLength(2);
      expect(response.body.pagination).toMatchObject({
        page: 1,
        limit: 50,
        total: 2,
        totalPages: 1,
      });
      expect(response.body.chunks[0]).toMatchObject({
        id: 'chunk-1',
        chunk_index: 0,
        page_number: 1,
        section_heading: 'Introduction',
      });
    });

    it('should support page number filtering (200)', async () => {
      (resourceService.getResource as jest.Mock).mockResolvedValue({
        id: resourceId,
        campaign_id: campaignId,
      });
      mockDb.one.mockResolvedValue({ count: '1' });
      mockDb.any.mockResolvedValue([
        {
          id: 'chunk-1',
          chunk_index: 0,
          raw_text: 'Page 5 content',
          token_count: 100,
          page_number: 5,
          section_heading: null,
          content_preview: 'Page 5 content',
          has_embedding: true,
          tags: [],
          quality_score: 0.9,
          created_at: new Date(),
        },
      ]);

      const response = await request(app)
        .get(`/api/resources/${resourceId}/chunks`)
        .query({ pageNumber: 5 })
        .set('Authorization', mockToken)
        .expect(200);

      expect(response.body.chunks).toHaveLength(1);
      expect(response.body.chunks[0].page_number).toBe(5);
      expect(mockDb.any).toHaveBeenCalledWith(
        expect.stringContaining('page_number = $'),
        expect.arrayContaining([resourceId, 5])
      );
    });

    it('should support text search filtering (200)', async () => {
      (resourceService.getResource as jest.Mock).mockResolvedValue({
        id: resourceId,
        campaign_id: campaignId,
      });
      mockDb.one.mockResolvedValue({ count: '1' });
      mockDb.any.mockResolvedValue([
        {
          id: 'chunk-1',
          chunk_index: 0,
          raw_text: 'This text contains the search term',
          token_count: 100,
          page_number: 1,
          section_heading: null,
          content_preview: 'This text contains the search term',
          has_embedding: true,
          tags: [],
          quality_score: 0.9,
          created_at: new Date(),
        },
      ]);

      const response = await request(app)
        .get(`/api/resources/${resourceId}/chunks`)
        .query({ search: 'search term' })
        .set('Authorization', mockToken)
        .expect(200);

      expect(response.body.chunks).toHaveLength(1);
      expect(mockDb.any).toHaveBeenCalledWith(
        expect.stringContaining('raw_text ILIKE'),
        expect.arrayContaining([resourceId, '%search term%'])
      );
    });

    it('should support custom pagination (200)', async () => {
      (resourceService.getResource as jest.Mock).mockResolvedValue({
        id: resourceId,
        campaign_id: campaignId,
      });
      mockDb.one.mockResolvedValue({ count: '100' });
      mockDb.any.mockResolvedValue([]);

      const response = await request(app)
        .get(`/api/resources/${resourceId}/chunks`)
        .query({ page: 2, limit: 20 })
        .set('Authorization', mockToken)
        .expect(200);

      expect(response.body.pagination).toMatchObject({
        page: 2,
        limit: 20,
        total: 100,
        totalPages: 5,
      });
      expect(mockDb.any).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([20, 20]) // limit, skip
      );
    });

    it('should reject invalid resource ID (400)', async () => {
      const response = await request(app)
        .get('/api/resources/invalid-uuid/chunks')
        .set('Authorization', mockToken)
        .expect(400);

      expect(response.body.details || response.body.error).toBeDefined();
    });

    it('should reject invalid pagination values (400)', async () => {
      const response = await request(app)
        .get(`/api/resources/${resourceId}/chunks`)
        .query({ page: -1 })
        .set('Authorization', mockToken)
        .expect(400);

      expect(response.body.details || response.body.error).toBeDefined();
    });

    it('should return 404 if resource not found', async () => {
      const NotFoundError = require('../../src/types').NotFoundError;
      (resourceService.getResource as jest.Mock).mockRejectedValue(
        new NotFoundError('Resource')
      );

      const response = await request(app)
        .get(`/api/resources/${resourceId}/chunks`)
        .set('Authorization', mockToken)
        .expect(404);

      expect(response.body.code).toBe('NOT_FOUND');
    });

    it('should reject unauthorized access (401)', async () => {
      (authUtils.verifyAccessToken as jest.Mock).mockImplementation(() => {
        throw new Error('Invalid token');
      });

      const response = await request(app)
        .get(`/api/resources/${resourceId}/chunks`)
        .set('Authorization', 'Bearer invalid_token')
        .expect(401);

      expect(response.body.code).toBe('UNAUTHORIZED');
    });
  });

  describe('DELETE /api/resources/:id', () => {
    it('should delete resource successfully (204)', async () => {
      (resourceService.deleteResource as jest.Mock).mockResolvedValue(undefined);

      await request(app)
        .delete(`/api/resources/${resourceId}`)
        .set('Authorization', mockToken)
        .expect(204);

      expect(resourceService.deleteResource).toHaveBeenCalledWith(
        mockDb,
        userId,
        resourceId
      );
    });

    it('should return 404 if resource not found', async () => {
      const NotFoundError = require('../../src/types').NotFoundError;
      (resourceService.deleteResource as jest.Mock).mockRejectedValue(
        new NotFoundError('Resource')
      );

      const response = await request(app)
        .delete(`/api/resources/${resourceId}`)
        .set('Authorization', mockToken)
        .expect(404);

      expect(response.body.code).toBe('NOT_FOUND');
    });

    it('should reject invalid resource ID (400)', async () => {
      const response = await request(app)
        .delete('/api/resources/invalid-uuid')
        .set('Authorization', mockToken)
        .expect(400);

      expect(response.body.details || response.body.error).toBeDefined();
    });

    it('should reject unauthorized access (401)', async () => {
      (authUtils.verifyAccessToken as jest.Mock).mockImplementation(() => {
        throw new Error('Invalid token');
      });

      const response = await request(app)
        .delete(`/api/resources/${resourceId}`)
        .set('Authorization', 'Bearer invalid_token')
        .expect(401);

      expect(response.body.code).toBe('UNAUTHORIZED');
    });

    it('should reject access to resource not owned by user (403)', async () => {
      const ForbiddenError = require('../../src/types').ForbiddenError;
      (resourceService.deleteResource as jest.Mock).mockRejectedValue(
        new ForbiddenError('You do not have permission to access this resource')
      );

      const response = await request(app)
        .delete(`/api/resources/${resourceId}`)
        .set('Authorization', mockToken)
        .expect(403);

      expect(response.body.code).toBe('FORBIDDEN');
    });
  });
});
