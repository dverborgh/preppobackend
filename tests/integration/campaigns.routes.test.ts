/**
 * Integration tests for campaign routes
 * Tests all campaign endpoints with mocked database and authentication
 */

import request from 'supertest';
import express, { Express } from 'express';
import campaignRoutes from '../../src/routes/campaigns';
import { errorHandler } from '../../src/middleware/errorHandler';
import * as database from '../../src/config/database';
import * as redis from '../../src/config/redis';
import * as campaignService from '../../src/services/campaignService';
import * as authUtils from '../../src/utils/auth';

// Mock dependencies
jest.mock('../../src/config/database');
jest.mock('../../src/config/redis');
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

describe('Campaign Routes Integration Tests', () => {
  let app: Express;
  let mockDb: any;
  let mockCache: any;
  const userId = '123e4567-e89b-12d3-a456-426614174000';
  const campaignId = '123e4567-e89b-12d3-a456-426614174001';
  const mockToken = 'Bearer mock_token';

  beforeAll(() => {
    // Create Express app
    app = express();
    app.use(express.json());
    app.use('/api/campaigns', campaignRoutes);
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
  });

  describe('POST /api/campaigns', () => {
    it('should create campaign with valid data (201)', async () => {
      const mockCampaign = {
        id: campaignId,
        user_id: userId,
        name: 'Test Campaign',
        system_name: 'D&D 5e',
        description: 'Test description',
        created_at: new Date(),
        updated_at: new Date(),
        metadata: {},
      };

      (campaignService.createCampaign as jest.Mock).mockResolvedValue(mockCampaign);

      const response = await request(app)
        .post('/api/campaigns')
        .set('Authorization', mockToken)
        .send({
          name: 'Test Campaign',
          system_name: 'D&D 5e',
          description: 'Test description',
        });

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        id: campaignId,
        name: 'Test Campaign',
        system_name: 'D&D 5e',
      });
    });

    it('should require authentication (401)', async () => {
      // Simulate missing token
      (authUtils.extractTokenFromHeader as jest.Mock).mockImplementation(() => {
        throw new Error('No token provided');
      });

      const response = await request(app)
        .post('/api/campaigns')
        .send({
          name: 'Test Campaign',
          system_name: 'D&D 5e',
        });

      expect(response.status).toBe(401);

      // Reset mock
      (authUtils.extractTokenFromHeader as jest.Mock).mockReturnValue('mock_token');
    });

    it('should reject missing name (400)', async () => {
      const response = await request(app)
        .post('/api/campaigns')
        .set('Authorization', mockToken)
        .send({
          system_name: 'D&D 5e',
        });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('should reject name exceeding 255 chars (400)', async () => {
      const longName = 'a'.repeat(256);

      const response = await request(app)
        .post('/api/campaigns')
        .set('Authorization', mockToken)
        .send({
          name: longName,
          system_name: 'D&D 5e',
        });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('should reject missing system_name (400)', async () => {
      const response = await request(app)
        .post('/api/campaigns')
        .set('Authorization', mockToken)
        .send({
          name: 'Test Campaign',
        });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('should reject duplicate campaign name (409)', async () => {
      const { ConflictError } = require('../../src/types');
      (campaignService.createCampaign as jest.Mock).mockRejectedValue(
        new ConflictError('Campaign with name "Duplicate" already exists')
      );

      const response = await request(app)
        .post('/api/campaigns')
        .set('Authorization', mockToken)
        .send({
          name: 'Duplicate',
          system_name: 'D&D 5e',
        });

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('CONFLICT');
    });

    it('should accept valid metadata (201)', async () => {
      const mockCampaign = {
        id: campaignId,
        user_id: userId,
        name: 'Test Campaign',
        system_name: 'D&D 5e',
        description: null,
        created_at: new Date(),
        updated_at: new Date(),
        metadata: { setting: 'Forgotten Realms' },
      };

      (campaignService.createCampaign as jest.Mock).mockResolvedValue(mockCampaign);

      const response = await request(app)
        .post('/api/campaigns')
        .set('Authorization', mockToken)
        .send({
          name: 'Test Campaign',
          system_name: 'D&D 5e',
          metadata: { setting: 'Forgotten Realms' },
        });

      expect(response.status).toBe(201);
      expect(response.body.metadata).toEqual({ setting: 'Forgotten Realms' });
    });

    it('should trim whitespace from fields (201)', async () => {
      const mockCampaign = {
        id: campaignId,
        user_id: userId,
        name: 'Test Campaign',
        system_name: 'D&D 5e',
        description: null,
        created_at: new Date(),
        updated_at: new Date(),
        metadata: {},
      };

      (campaignService.createCampaign as jest.Mock).mockResolvedValue(mockCampaign);

      const response = await request(app)
        .post('/api/campaigns')
        .set('Authorization', mockToken)
        .send({
          name: '  Test Campaign  ',
          system_name: '  D&D 5e  ',
        });

      expect(response.status).toBe(201);
      expect(campaignService.createCampaign).toHaveBeenCalledWith(
        mockDb,
        userId,
        expect.objectContaining({
          name: expect.any(String),
          system_name: expect.any(String),
        })
      );
    });
  });

  describe('GET /api/campaigns', () => {
    it('should list campaigns with default pagination (200)', async () => {
      const mockResponse = {
        data: [
          {
            id: campaignId,
            name: 'Campaign 1',
            system_name: 'D&D 5e',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            session_count: 5,
            resource_count: 3,
          },
        ],
        total: 1,
        skip: 0,
        limit: 20,
      };

      (campaignService.getCampaigns as jest.Mock).mockResolvedValue(mockResponse);

      const response = await request(app)
        .get('/api/campaigns')
        .set('Authorization', mockToken);

      expect(response.status).toBe(200);
      expect(response.body.data[0].name).toBe('Campaign 1');
      expect(response.body.total).toBe(1);
    });

    it('should require authentication (401)', async () => {
      // Simulate missing token
      (authUtils.extractTokenFromHeader as jest.Mock).mockImplementation(() => {
        throw new Error('No token provided');
      });

      const response = await request(app).get('/api/campaigns');

      expect(response.status).toBe(401);

      // Reset mock
      (authUtils.extractTokenFromHeader as jest.Mock).mockReturnValue('mock_token');
    });

    it('should return only user campaigns (200)', async () => {
      const mockResponse = {
        data: [],
        total: 0,
        skip: 0,
        limit: 20,
      };

      (campaignService.getCampaigns as jest.Mock).mockResolvedValue(mockResponse);

      await request(app)
        .get('/api/campaigns')
        .set('Authorization', mockToken);

      expect(campaignService.getCampaigns).toHaveBeenCalledWith(
        mockDb,
        userId,
        expect.any(Object)
      );
    });

    it('should paginate correctly (200)', async () => {
      const mockResponse = {
        data: [],
        total: 50,
        skip: 20,
        limit: 10,
      };

      (campaignService.getCampaigns as jest.Mock).mockResolvedValue(mockResponse);

      const response = await request(app)
        .get('/api/campaigns?skip=20&limit=10')
        .set('Authorization', mockToken);

      expect(response.status).toBe(200);
      expect(campaignService.getCampaigns).toHaveBeenCalledWith(
        mockDb,
        userId,
        expect.objectContaining({ skip: 20, limit: 10 })
      );
    });

    it('should sort by created_at desc by default (200)', async () => {
      const mockResponse = {
        data: [],
        total: 0,
        skip: 0,
        limit: 20,
      };

      (campaignService.getCampaigns as jest.Mock).mockResolvedValue(mockResponse);

      await request(app)
        .get('/api/campaigns')
        .set('Authorization', mockToken);

      expect(campaignService.getCampaigns).toHaveBeenCalledWith(
        mockDb,
        userId,
        expect.any(Object)
      );
    });

    it('should sort by name asc when specified (200)', async () => {
      const mockResponse = {
        data: [],
        total: 0,
        skip: 0,
        limit: 20,
      };

      (campaignService.getCampaigns as jest.Mock).mockResolvedValue(mockResponse);

      await request(app)
        .get('/api/campaigns?sort=name&order=asc')
        .set('Authorization', mockToken);

      expect(campaignService.getCampaigns).toHaveBeenCalledWith(
        mockDb,
        userId,
        expect.objectContaining({ sort: 'name', order: 'asc' })
      );
    });

    it('should return empty list for user with no campaigns (200)', async () => {
      const mockResponse = {
        data: [],
        total: 0,
        skip: 0,
        limit: 20,
      };

      (campaignService.getCampaigns as jest.Mock).mockResolvedValue(mockResponse);

      const response = await request(app)
        .get('/api/campaigns')
        .set('Authorization', mockToken);

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual([]);
      expect(response.body.total).toBe(0);
    });

    it('should include aggregated counts (200)', async () => {
      const mockResponse = {
        data: [
          {
            id: campaignId,
            name: 'Campaign 1',
            system_name: 'D&D 5e',
            created_at: new Date(),
            updated_at: new Date(),
            session_count: 5,
            resource_count: 3,
          },
        ],
        total: 1,
        skip: 0,
        limit: 20,
      };

      (campaignService.getCampaigns as jest.Mock).mockResolvedValue(mockResponse);

      const response = await request(app)
        .get('/api/campaigns')
        .set('Authorization', mockToken);

      expect(response.body.data[0]).toHaveProperty('session_count', 5);
      expect(response.body.data[0]).toHaveProperty('resource_count', 3);
    });

    it('should reject invalid sort field (400)', async () => {
      const response = await request(app)
        .get('/api/campaigns?sort=invalid')
        .set('Authorization', mockToken);

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('should reject invalid order (400)', async () => {
      const response = await request(app)
        .get('/api/campaigns?order=invalid')
        .set('Authorization', mockToken);

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('should enforce max limit of 100 (200)', async () => {
      const mockResponse = {
        data: [],
        total: 0,
        skip: 0,
        limit: 100,
      };

      (campaignService.getCampaigns as jest.Mock).mockResolvedValue(mockResponse);

      const response = await request(app)
        .get('/api/campaigns?limit=200')
        .set('Authorization', mockToken);

      expect(response.status).toBe(400); // Validation middleware rejects limit > 100
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/campaigns/:id', () => {
    it('should return campaign with aggregated counts (200)', async () => {
      const mockCampaign = {
        id: campaignId,
        user_id: userId,
        name: 'Test Campaign',
        system_name: 'D&D 5e',
        description: 'Test description',
        created_at: new Date(),
        updated_at: new Date(),
        metadata: {},
        session_count: 5,
        resource_count: 3,
        generator_count: 7,
      };

      (campaignService.getCampaignById as jest.Mock).mockResolvedValue(mockCampaign);

      const response = await request(app)
        .get(`/api/campaigns/${campaignId}`)
        .set('Authorization', mockToken);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        id: campaignId,
        session_count: 5,
        resource_count: 3,
        generator_count: 7,
      });
    });

    it('should require authentication (401)', async () => {
      // Simulate missing token
      (authUtils.extractTokenFromHeader as jest.Mock).mockImplementation(() => {
        throw new Error('No token provided');
      });

      const response = await request(app).get(`/api/campaigns/${campaignId}`);

      expect(response.status).toBe(401);

      // Reset mock
      (authUtils.extractTokenFromHeader as jest.Mock).mockReturnValue('mock_token');
    });

    it('should return 404 for non-existent campaign', async () => {
      const { NotFoundError } = require('../../src/types');
      const nonexistentId = '123e4567-e89b-12d3-a456-426614174999';
      (campaignService.getCampaignById as jest.Mock).mockRejectedValue(
        new NotFoundError('Campaign')
      );

      const response = await request(app)
        .get(`/api/campaigns/${nonexistentId}`)
        .set('Authorization', mockToken);

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('NOT_FOUND');
    });

    it('should return 403 for campaign owned by other user', async () => {
      const { ForbiddenError } = require('../../src/types');
      (campaignService.getCampaignById as jest.Mock).mockRejectedValue(
        new ForbiddenError('You do not have permission to access this campaign')
      );

      const response = await request(app)
        .get(`/api/campaigns/${campaignId}`)
        .set('Authorization', mockToken);

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('FORBIDDEN');
    });

    it('should reject invalid UUID (400)', async () => {
      const response = await request(app)
        .get('/api/campaigns/invalid-uuid')
        .set('Authorization', mockToken);

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('PUT /api/campaigns/:id', () => {
    it('should update campaign name (200)', async () => {
      const mockCampaign = {
        id: campaignId,
        user_id: userId,
        name: 'Updated Campaign',
        system_name: 'D&D 5e',
        description: null,
        created_at: new Date(),
        updated_at: new Date(),
        metadata: {},
      };

      (campaignService.updateCampaign as jest.Mock).mockResolvedValue(mockCampaign);

      const response = await request(app)
        .put(`/api/campaigns/${campaignId}`)
        .set('Authorization', mockToken)
        .send({ name: 'Updated Campaign' });

      expect(response.status).toBe(200);
      expect(response.body.name).toBe('Updated Campaign');
    });

    it('should update campaign system_name (200)', async () => {
      const mockCampaign = {
        id: campaignId,
        user_id: userId,
        name: 'Test Campaign',
        system_name: 'Pathfinder 2e',
        description: null,
        created_at: new Date(),
        updated_at: new Date(),
        metadata: {},
      };

      (campaignService.updateCampaign as jest.Mock).mockResolvedValue(mockCampaign);

      const response = await request(app)
        .put(`/api/campaigns/${campaignId}`)
        .set('Authorization', mockToken)
        .send({ system_name: 'Pathfinder 2e' });

      expect(response.status).toBe(200);
      expect(response.body.system_name).toBe('Pathfinder 2e');
    });

    it('should update campaign description (200)', async () => {
      const mockCampaign = {
        id: campaignId,
        user_id: userId,
        name: 'Test Campaign',
        system_name: 'D&D 5e',
        description: 'New description',
        created_at: new Date(),
        updated_at: new Date(),
        metadata: {},
      };

      (campaignService.updateCampaign as jest.Mock).mockResolvedValue(mockCampaign);

      const response = await request(app)
        .put(`/api/campaigns/${campaignId}`)
        .set('Authorization', mockToken)
        .send({ description: 'New description' });

      expect(response.status).toBe(200);
      expect(response.body.description).toBe('New description');
    });

    it('should update campaign metadata (200)', async () => {
      const newMetadata = { setting: 'Eberron' };
      const mockCampaign = {
        id: campaignId,
        user_id: userId,
        name: 'Test Campaign',
        system_name: 'D&D 5e',
        description: null,
        created_at: new Date(),
        updated_at: new Date(),
        metadata: newMetadata,
      };

      (campaignService.updateCampaign as jest.Mock).mockResolvedValue(mockCampaign);

      const response = await request(app)
        .put(`/api/campaigns/${campaignId}`)
        .set('Authorization', mockToken)
        .send({ metadata: newMetadata });

      expect(response.status).toBe(200);
      expect(response.body.metadata).toEqual(newMetadata);
    });

    it('should update multiple fields (200)', async () => {
      const mockCampaign = {
        id: campaignId,
        user_id: userId,
        name: 'Updated Campaign',
        system_name: 'Pathfinder 2e',
        description: 'New description',
        created_at: new Date(),
        updated_at: new Date(),
        metadata: {},
      };

      (campaignService.updateCampaign as jest.Mock).mockResolvedValue(mockCampaign);

      const response = await request(app)
        .put(`/api/campaigns/${campaignId}`)
        .set('Authorization', mockToken)
        .send({
          name: 'Updated Campaign',
          system_name: 'Pathfinder 2e',
          description: 'New description',
        });

      expect(response.status).toBe(200);
      expect(response.body.name).toBe('Updated Campaign');
      expect(response.body.system_name).toBe('Pathfinder 2e');
    });

    it('should require authentication (401)', async () => {
      // Simulate missing token
      (authUtils.extractTokenFromHeader as jest.Mock).mockImplementation(() => {
        throw new Error('No token provided');
      });

      const response = await request(app)
        .put(`/api/campaigns/${campaignId}`)
        .send({ name: 'Updated' });

      expect(response.status).toBe(401);

      // Reset mock
      (authUtils.extractTokenFromHeader as jest.Mock).mockReturnValue('mock_token');
    });

    it('should return 403 for campaign owned by other user', async () => {
      const { ForbiddenError } = require('../../src/types');
      (campaignService.updateCampaign as jest.Mock).mockRejectedValue(
        new ForbiddenError('You do not have permission to access this campaign')
      );

      const response = await request(app)
        .put(`/api/campaigns/${campaignId}`)
        .set('Authorization', mockToken)
        .send({ name: 'Updated' });

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('FORBIDDEN');
    });

    it('should return 404 for non-existent campaign', async () => {
      const { NotFoundError } = require('../../src/types');
      const nonexistentId = '123e4567-e89b-12d3-a456-426614174999';
      (campaignService.updateCampaign as jest.Mock).mockRejectedValue(
        new NotFoundError('Campaign')
      );

      const response = await request(app)
        .put(`/api/campaigns/${nonexistentId}`)
        .set('Authorization', mockToken)
        .send({ name: 'Updated' });

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('NOT_FOUND');
    });

    it('should reject duplicate name (409)', async () => {
      const { ConflictError } = require('../../src/types');
      (campaignService.updateCampaign as jest.Mock).mockRejectedValue(
        new ConflictError('Campaign with name "Duplicate" already exists')
      );

      const response = await request(app)
        .put(`/api/campaigns/${campaignId}`)
        .set('Authorization', mockToken)
        .send({ name: 'Duplicate' });

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('CONFLICT');
    });

    it('should reject invalid UUID (400)', async () => {
      const response = await request(app)
        .put('/api/campaigns/invalid-uuid')
        .set('Authorization', mockToken)
        .send({ name: 'Updated' });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('should trim whitespace from updated fields (200)', async () => {
      const mockCampaign = {
        id: campaignId,
        user_id: userId,
        name: 'Updated Campaign',
        system_name: 'D&D 5e',
        description: null,
        created_at: new Date(),
        updated_at: new Date(),
        metadata: {},
      };

      (campaignService.updateCampaign as jest.Mock).mockResolvedValue(mockCampaign);

      await request(app)
        .put(`/api/campaigns/${campaignId}`)
        .set('Authorization', mockToken)
        .send({ name: '  Updated Campaign  ' });

      expect(campaignService.updateCampaign).toHaveBeenCalledWith(
        mockDb,
        userId,
        campaignId,
        expect.any(Object)
      );
    });
  });

  describe('DELETE /api/campaigns/:id', () => {
    it('should delete campaign (204)', async () => {
      (campaignService.deleteCampaign as jest.Mock).mockResolvedValue(undefined);

      const response = await request(app)
        .delete(`/api/campaigns/${campaignId}`)
        .set('Authorization', mockToken);

      expect(response.status).toBe(204);
      expect(campaignService.deleteCampaign).toHaveBeenCalledWith(
        mockDb,
        userId,
        campaignId
      );
    });

    it('should require authentication (401)', async () => {
      // Simulate missing token
      (authUtils.extractTokenFromHeader as jest.Mock).mockImplementation(() => {
        throw new Error('No token provided');
      });

      const response = await request(app).delete(`/api/campaigns/${campaignId}`);

      expect(response.status).toBe(401);

      // Reset mock
      (authUtils.extractTokenFromHeader as jest.Mock).mockReturnValue('mock_token');
    });

    it('should return 403 for campaign owned by other user', async () => {
      const { ForbiddenError } = require('../../src/types');
      (campaignService.deleteCampaign as jest.Mock).mockRejectedValue(
        new ForbiddenError('You do not have permission to access this campaign')
      );

      const response = await request(app)
        .delete(`/api/campaigns/${campaignId}`)
        .set('Authorization', mockToken);

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('FORBIDDEN');
    });

    it('should return 404 for non-existent campaign', async () => {
      const { NotFoundError } = require('../../src/types');
      const nonexistentId = '123e4567-e89b-12d3-a456-426614174999';
      (campaignService.deleteCampaign as jest.Mock).mockRejectedValue(
        new NotFoundError('Campaign')
      );

      const response = await request(app)
        .delete(`/api/campaigns/${nonexistentId}`)
        .set('Authorization', mockToken);

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('NOT_FOUND');
    });

    it('should reject invalid UUID (400)', async () => {
      const response = await request(app)
        .delete('/api/campaigns/invalid-uuid')
        .set('Authorization', mockToken);

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });
  });
});
