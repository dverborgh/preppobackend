/**
 * Integration tests for generator routes
 * Tests all generator endpoints with mocked services and OpenAI
 */

import request from 'supertest';
import express, { Express } from 'express';
import generatorRoutes from '../../src/routes/generators';
import { errorHandler } from '../../src/middleware/errorHandler';
import * as database from '../../src/config/database';
import * as redis from '../../src/config/redis';
import * as generatorService from '../../src/services/generatorService';
import * as generatorRollService from '../../src/services/generatorRollService';
import * as generatorDesignerService from '../../src/services/generatorDesignerService';
import * as campaignService from '../../src/services/campaignService';
import * as authUtils from '../../src/utils/auth';

// Mock dependencies
jest.mock('../../src/config/database');
jest.mock('../../src/config/redis');
jest.mock('../../src/services/generatorService');
jest.mock('../../src/services/generatorRollService');
jest.mock('../../src/services/generatorDesignerService');
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

describe('Generator Routes Integration Tests', () => {
  let app: Express;
  let mockDb: any;
  let mockCache: any;
  const userId = '123e4567-e89b-12d3-a456-426614174000';
  const campaignId = '123e4567-e89b-12d3-a456-426614174001';
  const generatorId = '123e4567-e89b-12d3-a456-426614174002';
  const sessionId = '123e4567-e89b-12d3-a456-426614174003';
  const sceneId = '123e4567-e89b-12d3-a456-426614174004';
  const mockToken = 'Bearer mock_token';

  beforeAll(() => {
    // Create Express app
    app = express();
    app.use(express.json());

    // API Router setup
    const apiRouter = express.Router();
    apiRouter.use('/', generatorRoutes);

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
      tx: jest.fn(),
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
    (campaignService.verifyCampaignOwnership as jest.Mock).mockResolvedValue(undefined);
  });

  describe('POST /api/campaigns/:campaignId/generators', () => {
    it('should create a table mode generator successfully (201)', async () => {
      const mockGenerator = {
        id: generatorId,
        campaign_id: campaignId,
        name: 'Random NPC Generator',
        description: 'Generates random NPCs for encounters',
        mode: 'table',
        output_schema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            role: { type: 'string' },
          },
        },
        output_example: { name: 'John Smith', role: 'Merchant' },
        created_by_prompt: null,
        primary_table_id: 'table-123',
        status: 'active',
        created_at: new Date(),
        updated_at: new Date(),
        tables: [
          {
            id: 'table-123',
            generator_id: generatorId,
            name: 'NPC Types',
            description: 'Types of NPCs',
            roll_method: 'weighted_random',
            created_at: new Date(),
            entries: [
              {
                id: 'entry-1',
                table_id: 'table-123',
                entry_key: 'merchant',
                entry_text: 'A friendly merchant {"name": "Merchant", "role": "Shopkeeper"}',
                weight: 50,
                roll_min: null,
                roll_max: null,
                display_order: 0,
                created_at: new Date(),
              },
              {
                id: 'entry-2',
                table_id: 'table-123',
                entry_key: 'guard',
                entry_text: 'A stern guard {"name": "Guard", "role": "City Watch"}',
                weight: 30,
                roll_min: null,
                roll_max: null,
                display_order: 1,
                created_at: new Date(),
              },
            ],
          },
        ],
      };

      (generatorService.createGenerator as jest.Mock).mockResolvedValue(mockGenerator);

      const response = await request(app)
        .post(`/api/campaigns/${campaignId}/generators`)
        .set('Authorization', mockToken)
        .send({
          name: 'Random NPC Generator',
          description: 'Generates random NPCs for encounters',
          mode: 'table',
          output_schema: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              role: { type: 'string' },
            },
          },
          tables: [
            {
              name: 'NPC Types',
              entries: [
                {
                  entry_key: 'merchant',
                  entry_text: 'A friendly merchant {"name": "Merchant", "role": "Shopkeeper"}',
                  weight: 50,
                },
                {
                  entry_key: 'guard',
                  entry_text: 'A stern guard {"name": "Guard", "role": "City Watch"}',
                  weight: 30,
                },
              ],
            },
          ],
        })
        .expect(201);

      expect(response.body).toMatchObject({
        id: generatorId,
        campaign_id: campaignId,
        name: 'Random NPC Generator',
        mode: 'table',
      });
      expect(generatorService.createGenerator).toHaveBeenCalledWith(
        mockDb,
        userId,
        campaignId,
        expect.objectContaining({
          name: 'Random NPC Generator',
          mode: 'table',
        })
      );
    });

    it('should create an LLM mode generator successfully (201)', async () => {
      const mockGenerator = {
        id: generatorId,
        campaign_id: campaignId,
        name: 'Story Hook Generator',
        description: 'Generates story hooks using LLM',
        mode: 'llm',
        output_schema: {
          type: 'object',
          properties: {
            hook: { type: 'string' },
          },
        },
        output_example: { hook: 'A mysterious letter arrives...' },
        created_by_prompt: null,
        primary_table_id: null,
        status: 'active',
        created_at: new Date(),
        updated_at: new Date(),
        tables: [],
      };

      (generatorService.createGenerator as jest.Mock).mockResolvedValue(mockGenerator);

      const response = await request(app)
        .post(`/api/campaigns/${campaignId}/generators`)
        .set('Authorization', mockToken)
        .send({
          name: 'Story Hook Generator',
          description: 'Generates story hooks using LLM',
          mode: 'llm',
          output_schema: {
            type: 'object',
            properties: {
              hook: { type: 'string' },
            },
          },
        })
        .expect(201);

      expect(response.body.mode).toBe('llm');
    });

    it('should reject creation without name (400)', async () => {
      const response = await request(app)
        .post(`/api/campaigns/${campaignId}/generators`)
        .set('Authorization', mockToken)
        .send({
          description: 'Missing name',
          mode: 'table',
          output_schema: { type: 'object', properties: {} },
        })
        .expect(400);

      expect(response.body.details || response.body.error).toBeDefined();
    });

    it('should reject creation with invalid mode (400)', async () => {
      const response = await request(app)
        .post(`/api/campaigns/${campaignId}/generators`)
        .set('Authorization', mockToken)
        .send({
          name: 'Test Generator',
          description: 'Test',
          mode: 'invalid_mode',
          output_schema: { type: 'object', properties: {} },
        })
        .expect(400);

      expect(response.body.details || response.body.error).toBeDefined();
    });

    it('should reject creation with invalid output_schema (400)', async () => {
      const response = await request(app)
        .post(`/api/campaigns/${campaignId}/generators`)
        .set('Authorization', mockToken)
        .send({
          name: 'Test Generator',
          description: 'Test',
          mode: 'table',
          output_schema: 'not an object',
        })
        .expect(400);

      expect(response.body.details || response.body.error).toBeDefined();
    });

    it('should reject creation with invalid campaign ID (400)', async () => {
      const response = await request(app)
        .post('/api/campaigns/invalid-uuid/generators')
        .set('Authorization', mockToken)
        .send({
          name: 'Test Generator',
          description: 'Test',
          mode: 'table',
          output_schema: { type: 'object', properties: {} },
        })
        .expect(400);

      expect(response.body.details || response.body.error).toBeDefined();
    });

    it('should reject unauthorized access (401)', async () => {
      (authUtils.verifyAccessToken as jest.Mock).mockImplementation(() => {
        throw new Error('Invalid token');
      });

      const response = await request(app)
        .post(`/api/campaigns/${campaignId}/generators`)
        .set('Authorization', 'Bearer invalid_token')
        .send({
          name: 'Test Generator',
          description: 'Test',
          mode: 'table',
          output_schema: { type: 'object', properties: {} },
        })
        .expect(401);

      expect(response.body.code).toBe('UNAUTHORIZED');
    });

    it('should reject access to campaign not owned by user (403)', async () => {
      const ForbiddenError = require('../../src/types').ForbiddenError;
      (generatorService.createGenerator as jest.Mock).mockRejectedValue(
        new ForbiddenError('You do not have permission to access this campaign')
      );

      const response = await request(app)
        .post(`/api/campaigns/${campaignId}/generators`)
        .set('Authorization', mockToken)
        .send({
          name: 'Test Generator',
          description: 'Test',
          mode: 'table',
          output_schema: { type: 'object', properties: {} },
        })
        .expect(403);

      expect(response.body.code).toBe('FORBIDDEN');
    });
  });

  describe('GET /api/campaigns/:campaignId/generators', () => {
    it('should list generators with default pagination (200)', async () => {
      const mockGenerators = [
        {
          id: 'gen-1',
          campaign_id: campaignId,
          name: 'Generator 1',
          description: 'First generator',
          mode: 'table',
          status: 'active',
          created_at: new Date(),
        },
        {
          id: 'gen-2',
          campaign_id: campaignId,
          name: 'Generator 2',
          description: 'Second generator',
          mode: 'llm',
          status: 'active',
          created_at: new Date(),
        },
      ];

      (generatorService.listGenerators as jest.Mock).mockResolvedValue({
        data: mockGenerators,
        total: 2,
        skip: 0,
        limit: 50,
      });

      const response = await request(app)
        .get(`/api/campaigns/${campaignId}/generators`)
        .set('Authorization', mockToken)
        .expect(200);

      expect(response.body.data).toHaveLength(2);
      expect(response.body.total).toBe(2);
      expect(response.body.skip).toBe(0);
      expect(response.body.limit).toBe(50);
      expect(generatorService.listGenerators).toHaveBeenCalledWith(
        mockDb,
        userId,
        campaignId,
        expect.objectContaining({})
      );
    });

    it('should list generators with custom pagination (200)', async () => {
      (generatorService.listGenerators as jest.Mock).mockResolvedValue({
        data: [],
        total: 100,
        skip: 20,
        limit: 10,
      });

      const response = await request(app)
        .get(`/api/campaigns/${campaignId}/generators?skip=20&limit=10`)
        .set('Authorization', mockToken)
        .expect(200);

      expect(response.body.skip).toBe(20);
      expect(response.body.limit).toBe(10);
      expect(generatorService.listGenerators).toHaveBeenCalledWith(
        mockDb,
        userId,
        campaignId,
        expect.objectContaining({
          skip: 20,
          limit: 10,
        })
      );
    });

    it('should filter generators by status (200)', async () => {
      (generatorService.listGenerators as jest.Mock).mockResolvedValue({
        data: [],
        total: 5,
        skip: 0,
        limit: 50,
      });

      await request(app)
        .get(`/api/campaigns/${campaignId}/generators?status=archived`)
        .set('Authorization', mockToken)
        .expect(200);

      expect(generatorService.listGenerators).toHaveBeenCalledWith(
        mockDb,
        userId,
        campaignId,
        expect.objectContaining({
          status: 'archived',
        })
      );
    });

    it('should reject invalid status filter (400)', async () => {
      const response = await request(app)
        .get(`/api/campaigns/${campaignId}/generators?status=invalid`)
        .set('Authorization', mockToken)
        .expect(400);

      expect(response.body.details || response.body.error).toBeDefined();
    });

    it('should reject invalid pagination parameters (400)', async () => {
      const response = await request(app)
        .get(`/api/campaigns/${campaignId}/generators?skip=-1`)
        .set('Authorization', mockToken)
        .expect(400);

      expect(response.body.details || response.body.error).toBeDefined();
    });
  });

  describe('GET /api/campaigns/:campaignId/generators/:id', () => {
    it('should get generator with full table structure (200)', async () => {
      const mockGenerator = {
        id: generatorId,
        campaign_id: campaignId,
        name: 'Test Generator',
        description: 'Test description',
        mode: 'table',
        output_schema: { type: 'object', properties: {} },
        output_example: null,
        created_by_prompt: null,
        primary_table_id: 'table-123',
        status: 'active',
        created_at: new Date(),
        updated_at: new Date(),
        tables: [
          {
            id: 'table-123',
            generator_id: generatorId,
            name: 'Main Table',
            description: null,
            roll_method: 'weighted_random',
            created_at: new Date(),
            entries: [
              {
                id: 'entry-1',
                table_id: 'table-123',
                entry_key: 'result_1',
                entry_text: 'Result 1',
                weight: 50,
                roll_min: null,
                roll_max: null,
                display_order: 0,
                created_at: new Date(),
              },
            ],
          },
        ],
      };

      (generatorService.getGenerator as jest.Mock).mockResolvedValue(mockGenerator);

      const response = await request(app)
        .get(`/api/campaigns/${campaignId}/generators/${generatorId}`)
        .set('Authorization', mockToken)
        .expect(200);

      expect(response.body).toMatchObject({
        id: generatorId,
        campaign_id: campaignId,
        name: 'Test Generator',
      });
      expect(response.body.tables).toHaveLength(1);
      expect(response.body.tables[0].entries).toHaveLength(1);
    });

    it('should return 404 if generator not found', async () => {
      const NotFoundError = require('../../src/types').NotFoundError;
      (generatorService.getGenerator as jest.Mock).mockRejectedValue(
        new NotFoundError('Generator')
      );

      const response = await request(app)
        .get(`/api/campaigns/${campaignId}/generators/${generatorId}`)
        .set('Authorization', mockToken)
        .expect(404);

      expect(response.body.code).toBe('NOT_FOUND');
    });

    it('should reject invalid generator ID (400)', async () => {
      const response = await request(app)
        .get(`/api/campaigns/${campaignId}/generators/invalid-uuid`)
        .set('Authorization', mockToken)
        .expect(400);

      expect(response.body.details || response.body.error).toBeDefined();
    });
  });

  describe('PUT /api/campaigns/:campaignId/generators/:id', () => {
    it('should update generator successfully (200)', async () => {
      const mockUpdatedGenerator = {
        id: generatorId,
        campaign_id: campaignId,
        name: 'Updated Generator Name',
        description: 'Updated description',
        mode: 'table',
        output_schema: { type: 'object', properties: {} },
        output_example: null,
        created_by_prompt: null,
        primary_table_id: 'table-123',
        status: 'archived',
        created_at: new Date(),
        updated_at: new Date(),
      };

      (generatorService.updateGenerator as jest.Mock).mockResolvedValue(mockUpdatedGenerator);

      const response = await request(app)
        .put(`/api/campaigns/${campaignId}/generators/${generatorId}`)
        .set('Authorization', mockToken)
        .send({
          name: 'Updated Generator Name',
          description: 'Updated description',
          status: 'archived',
        })
        .expect(200);

      expect(response.body.name).toBe('Updated Generator Name');
      expect(response.body.status).toBe('archived');
      expect(generatorService.updateGenerator).toHaveBeenCalledWith(
        mockDb,
        userId,
        campaignId,
        generatorId,
        expect.objectContaining({
          name: 'Updated Generator Name',
          status: 'archived',
        })
      );
    });

    it('should update only provided fields (200)', async () => {
      const mockUpdatedGenerator = {
        id: generatorId,
        campaign_id: campaignId,
        name: 'Updated Name Only',
        description: 'Original description',
        mode: 'table',
        output_schema: { type: 'object', properties: {} },
        output_example: null,
        created_by_prompt: null,
        primary_table_id: 'table-123',
        status: 'active',
        created_at: new Date(),
        updated_at: new Date(),
      };

      (generatorService.updateGenerator as jest.Mock).mockResolvedValue(mockUpdatedGenerator);

      const response = await request(app)
        .put(`/api/campaigns/${campaignId}/generators/${generatorId}`)
        .set('Authorization', mockToken)
        .send({
          name: 'Updated Name Only',
        })
        .expect(200);

      expect(response.body.name).toBe('Updated Name Only');
    });

    it('should reject update with invalid status (400)', async () => {
      const response = await request(app)
        .put(`/api/campaigns/${campaignId}/generators/${generatorId}`)
        .set('Authorization', mockToken)
        .send({
          status: 'invalid_status',
        })
        .expect(400);

      expect(response.body.details || response.body.error).toBeDefined();
    });

    it('should return 404 if generator not found', async () => {
      const NotFoundError = require('../../src/types').NotFoundError;
      (generatorService.updateGenerator as jest.Mock).mockRejectedValue(
        new NotFoundError('Generator')
      );

      const response = await request(app)
        .put(`/api/campaigns/${campaignId}/generators/${generatorId}`)
        .set('Authorization', mockToken)
        .send({
          name: 'Updated Name',
        })
        .expect(404);

      expect(response.body.code).toBe('NOT_FOUND');
    });
  });

  describe('DELETE /api/campaigns/:campaignId/generators/:id', () => {
    it('should delete generator successfully (204)', async () => {
      (generatorService.deleteGenerator as jest.Mock).mockResolvedValue(undefined);

      await request(app)
        .delete(`/api/campaigns/${campaignId}/generators/${generatorId}`)
        .set('Authorization', mockToken)
        .expect(204);

      expect(generatorService.deleteGenerator).toHaveBeenCalledWith(
        mockDb,
        userId,
        campaignId,
        generatorId
      );
    });

    it('should return 404 if generator not found', async () => {
      const NotFoundError = require('../../src/types').NotFoundError;
      (generatorService.deleteGenerator as jest.Mock).mockRejectedValue(
        new NotFoundError('Generator')
      );

      const response = await request(app)
        .delete(`/api/campaigns/${campaignId}/generators/${generatorId}`)
        .set('Authorization', mockToken)
        .expect(404);

      expect(response.body.code).toBe('NOT_FOUND');
    });

    it('should reject invalid generator ID (400)', async () => {
      const response = await request(app)
        .delete(`/api/campaigns/${campaignId}/generators/invalid-uuid`)
        .set('Authorization', mockToken)
        .expect(400);

      expect(response.body.details || response.body.error).toBeDefined();
    });
  });

  describe('POST /api/campaigns/:campaignId/generators/:id/roll', () => {
    it('should execute a generator roll successfully under 300ms (200)', async () => {
      const mockRollResult = {
        id: 'roll-123',
        generator_id: generatorId,
        generator_name: 'Test Generator',
        rolled_value: {
          name: 'Merchant',
          role: 'Shopkeeper',
          entry_key: 'merchant',
        },
        entry_key: 'merchant',
        entry_text: 'A friendly merchant {"name": "Merchant", "role": "Shopkeeper"}',
        random_seed: '12345-seed',
        roll_timestamp: new Date(),
        latency_ms: 45, // Well under 300ms
      };

      (generatorRollService.executeRoll as jest.Mock).mockResolvedValue(mockRollResult);

      const startTime = Date.now();
      const response = await request(app)
        .post(`/api/campaigns/${campaignId}/generators/${generatorId}/roll`)
        .set('Authorization', mockToken)
        .send({
          session_id: sessionId,
          scene_id: sceneId,
        })
        .expect(200);
      const endTime = Date.now();
      const totalLatency = endTime - startTime;

      expect(response.body).toMatchObject({
        id: 'roll-123',
        generator_id: generatorId,
        rolled_value: expect.objectContaining({
          name: 'Merchant',
          entry_key: 'merchant',
        }),
      });
      expect(response.body.latency_ms).toBeLessThan(300);
      // Total API latency should also be reasonable (< 500ms including HTTP overhead)
      expect(totalLatency).toBeLessThan(500);
      expect(generatorRollService.executeRoll).toHaveBeenCalledWith(
        mockDb,
        userId,
        campaignId,
        generatorId,
        expect.objectContaining({
          session_id: sessionId,
          scene_id: sceneId,
        })
      );
    });

    it('should execute roll in test mode (no database log) (200)', async () => {
      const mockRollResult = {
        // No id in test mode
        generator_id: generatorId,
        generator_name: 'Test Generator',
        rolled_value: { result: 'Test Result', entry_key: 'test' },
        entry_key: 'test',
        entry_text: 'Test entry',
        random_seed: 'test-seed',
        roll_timestamp: new Date(),
        latency_ms: 30,
      };

      (generatorRollService.executeRoll as jest.Mock).mockResolvedValue(mockRollResult);

      const response = await request(app)
        .post(`/api/campaigns/${campaignId}/generators/${generatorId}/roll`)
        .set('Authorization', mockToken)
        .send({
          session_id: sessionId,
          test_mode: true,
        })
        .expect(200);

      expect(response.body.id).toBeUndefined(); // No ID in test mode
      expect(generatorRollService.executeRoll).toHaveBeenCalledWith(
        mockDb,
        userId,
        campaignId,
        generatorId,
        expect.objectContaining({
          test_mode: true,
        })
      );
    });

    it('should execute roll with custom seed (200)', async () => {
      const customSeed = 'custom-seed-12345';
      const mockRollResult = {
        id: 'roll-123',
        generator_id: generatorId,
        generator_name: 'Test Generator',
        rolled_value: { result: 'Seeded Result', entry_key: 'result' },
        entry_key: 'result',
        entry_text: 'Seeded entry',
        random_seed: customSeed,
        roll_timestamp: new Date(),
        latency_ms: 40,
      };

      (generatorRollService.executeRoll as jest.Mock).mockResolvedValue(mockRollResult);

      const response = await request(app)
        .post(`/api/campaigns/${campaignId}/generators/${generatorId}/roll`)
        .set('Authorization', mockToken)
        .send({
          session_id: sessionId,
          seed: customSeed,
        })
        .expect(200);

      expect(response.body.random_seed).toBe(customSeed);
    });

    it('should reject roll without sessionId (400)', async () => {
      const response = await request(app)
        .post(`/api/campaigns/${campaignId}/generators/${generatorId}/roll`)
        .set('Authorization', mockToken)
        .send({
          scene_id: sceneId, // Missing session_id
        })
        .expect(400);

      expect(response.body.details || response.body.error).toBeDefined();
    });

    it('should reject roll with invalid sessionId (400)', async () => {
      const response = await request(app)
        .post(`/api/campaigns/${campaignId}/generators/${generatorId}/roll`)
        .set('Authorization', mockToken)
        .send({
          session_id: 'invalid-uuid',
        })
        .expect(400);

      expect(response.body.details || response.body.error).toBeDefined();
    });

    it('should reject roll with invalid sceneId (400)', async () => {
      const response = await request(app)
        .post(`/api/campaigns/${campaignId}/generators/${generatorId}/roll`)
        .set('Authorization', mockToken)
        .send({
          session_id: sessionId,
          scene_id: 'invalid-uuid',
        })
        .expect(400);

      expect(response.body.details || response.body.error).toBeDefined();
    });

    it('should handle roll errors gracefully (404 if generator not found)', async () => {
      const NotFoundError = require('../../src/types').NotFoundError;
      (generatorRollService.executeRoll as jest.Mock).mockRejectedValue(
        new NotFoundError('Generator')
      );

      const response = await request(app)
        .post(`/api/campaigns/${campaignId}/generators/${generatorId}/roll`)
        .set('Authorization', mockToken)
        .send({
          session_id: sessionId,
        })
        .expect(404);

      expect(response.body.code).toBe('NOT_FOUND');
    });

    it('should handle validation errors (400 if generator not active)', async () => {
      const ValidationError = require('../../src/types').ValidationError;
      (generatorRollService.executeRoll as jest.Mock).mockRejectedValue(
        new ValidationError('Generator is not active')
      );

      const response = await request(app)
        .post(`/api/campaigns/${campaignId}/generators/${generatorId}/roll`)
        .set('Authorization', mockToken)
        .send({
          session_id: sessionId,
        })
        .expect(400);

      expect(response.body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/campaigns/:campaignId/generators/:id/rolls', () => {
    it('should get roll history with default pagination (200)', async () => {
      const mockRolls = [
        {
          id: 'roll-1',
          generator_id: generatorId,
          session_id: sessionId,
          scene_id: sceneId,
          rolled_value: { result: 'Result 1' },
          random_seed: 'seed-1',
          roll_timestamp: new Date(),
          rolled_by_user_id: userId,
        },
        {
          id: 'roll-2',
          generator_id: generatorId,
          session_id: sessionId,
          scene_id: sceneId,
          rolled_value: { result: 'Result 2' },
          random_seed: 'seed-2',
          roll_timestamp: new Date(),
          rolled_by_user_id: userId,
        },
      ];

      (generatorRollService.getRollHistory as jest.Mock).mockResolvedValue({
        data: mockRolls,
        total: 2,
        skip: 0,
        limit: 50,
      });

      const response = await request(app)
        .get(`/api/campaigns/${campaignId}/generators/${generatorId}/rolls`)
        .set('Authorization', mockToken)
        .expect(200);

      expect(response.body.data).toHaveLength(2);
      expect(response.body.total).toBe(2);
    });

    it('should filter roll history by sessionId (200)', async () => {
      (generatorRollService.getRollHistory as jest.Mock).mockResolvedValue({
        data: [],
        total: 5,
        skip: 0,
        limit: 50,
      });

      await request(app)
        .get(`/api/campaigns/${campaignId}/generators/${generatorId}/rolls?sessionId=${sessionId}`)
        .set('Authorization', mockToken)
        .expect(200);

      expect(generatorRollService.getRollHistory).toHaveBeenCalledWith(
        mockDb,
        userId,
        campaignId,
        generatorId,
        expect.objectContaining({
          sessionId: sessionId, // Note: query params use camelCase
        })
      );
    });

    it('should filter roll history by sceneId (200)', async () => {
      (generatorRollService.getRollHistory as jest.Mock).mockResolvedValue({
        data: [],
        total: 3,
        skip: 0,
        limit: 50,
      });

      await request(app)
        .get(`/api/campaigns/${campaignId}/generators/${generatorId}/rolls?sceneId=${sceneId}`)
        .set('Authorization', mockToken)
        .expect(200);

      expect(generatorRollService.getRollHistory).toHaveBeenCalledWith(
        mockDb,
        userId,
        campaignId,
        generatorId,
        expect.objectContaining({
          sceneId: sceneId, // Note: query params use camelCase
        })
      );
    });

    it('should reject invalid sessionId filter (400)', async () => {
      const response = await request(app)
        .get(`/api/campaigns/${campaignId}/generators/${generatorId}/rolls?sessionId=invalid-uuid`)
        .set('Authorization', mockToken)
        .expect(400);

      expect(response.body.details || response.body.error).toBeDefined();
    });
  });

  describe('GET /api/campaigns/:campaignId/generators/:id/statistics', () => {
    it('should get roll statistics successfully (200)', async () => {
      const mockStatistics = {
        total_rolls: 100,
        entry_distribution: [
          {
            entry_key: 'merchant',
            count: 60,
            percentage: 60,
          },
          {
            entry_key: 'guard',
            count: 30,
            percentage: 30,
          },
          {
            entry_key: 'noble',
            count: 10,
            percentage: 10,
          },
        ],
      };

      (generatorRollService.getRollStatistics as jest.Mock).mockResolvedValue(mockStatistics);

      const response = await request(app)
        .get(`/api/campaigns/${campaignId}/generators/${generatorId}/statistics`)
        .set('Authorization', mockToken)
        .expect(200);

      expect(response.body).toMatchObject({
        total_rolls: 100,
        entry_distribution: expect.arrayContaining([
          expect.objectContaining({
            entry_key: 'merchant',
            count: 60,
            percentage: 60,
          }),
        ]),
      });
    });

    it('should filter statistics by sessionId (200)', async () => {
      const mockStatistics = {
        total_rolls: 25,
        entry_distribution: [
          {
            entry_key: 'merchant',
            count: 15,
            percentage: 60,
          },
        ],
      };

      (generatorRollService.getRollStatistics as jest.Mock).mockResolvedValue(mockStatistics);

      await request(app)
        .get(`/api/campaigns/${campaignId}/generators/${generatorId}/statistics?sessionId=${sessionId}`)
        .set('Authorization', mockToken)
        .expect(200);

      expect(generatorRollService.getRollStatistics).toHaveBeenCalledWith(
        mockDb,
        userId,
        campaignId,
        generatorId,
        sessionId
      );
    });

    it('should return empty statistics if no rolls (200)', async () => {
      const mockStatistics = {
        total_rolls: 0,
        entry_distribution: [],
      };

      (generatorRollService.getRollStatistics as jest.Mock).mockResolvedValue(mockStatistics);

      const response = await request(app)
        .get(`/api/campaigns/${campaignId}/generators/${generatorId}/statistics`)
        .set('Authorization', mockToken)
        .expect(200);

      expect(response.body.total_rolls).toBe(0);
      expect(response.body.entry_distribution).toHaveLength(0);
    });
  });

  describe('POST /api/campaigns/:campaignId/generators/design', () => {
    it('should design and create generator from natural language (201)', async () => {
      const mockDesignedGenerator = {
        id: generatorId,
        campaign_id: campaignId,
        name: 'Random Treasure Generator',
        description: 'Generates random treasure items',
        mode: 'table',
        output_schema: {
          type: 'object',
          properties: {
            item: { type: 'string' },
            value: { type: 'number' },
          },
        },
        output_example: { item: 'Gold Coin', value: 10 },
        created_by_prompt: 'Create a treasure generator for a fantasy campaign',
        primary_table_id: 'table-123',
        status: 'active',
        created_at: new Date(),
        updated_at: new Date(),
        tables: [
          {
            id: 'table-123',
            generator_id: generatorId,
            name: 'Treasure Items',
            description: 'Common to rare treasure',
            roll_method: 'weighted_random',
            created_at: new Date(),
            entries: [
              {
                id: 'entry-1',
                table_id: 'table-123',
                entry_key: 'gold_coins',
                entry_text: '10 Gold Coins {"item": "Gold Coins", "value": 10}',
                weight: 60,
                roll_min: null,
                roll_max: null,
                display_order: 0,
                created_at: new Date(),
              },
            ],
          },
        ],
      };

      (generatorDesignerService.designAndCreateGenerator as jest.Mock).mockResolvedValue(
        mockDesignedGenerator
      );

      const response = await request(app)
        .post(`/api/campaigns/${campaignId}/generators/design`)
        .set('Authorization', mockToken)
        .send({
          natural_language_spec: 'Create a treasure generator for a fantasy campaign',
          system_name: 'D&D 5e',
        })
        .expect(201);

      expect(response.body).toMatchObject({
        id: generatorId,
        name: 'Random Treasure Generator',
        mode: 'table',
        created_by_prompt: 'Create a treasure generator for a fantasy campaign',
      });
      expect(generatorDesignerService.designAndCreateGenerator).toHaveBeenCalledWith(
        mockDb,
        userId,
        campaignId,
        expect.objectContaining({
          natural_language_spec: 'Create a treasure generator for a fantasy campaign',
          system_name: 'D&D 5e',
        })
      );
    });

    it('should design generator without system_name (201)', async () => {
      const mockDesignedGenerator = {
        id: generatorId,
        campaign_id: campaignId,
        name: 'Generic NPC Generator',
        description: 'Generates NPCs',
        mode: 'table',
        output_schema: { type: 'object', properties: {} },
        output_example: {},
        created_by_prompt: 'Create an NPC generator',
        primary_table_id: 'table-123',
        status: 'active',
        created_at: new Date(),
        updated_at: new Date(),
        tables: [],
      };

      (generatorDesignerService.designAndCreateGenerator as jest.Mock).mockResolvedValue(
        mockDesignedGenerator
      );

      const response = await request(app)
        .post(`/api/campaigns/${campaignId}/generators/design`)
        .set('Authorization', mockToken)
        .send({
          natural_language_spec: 'Create an NPC generator',
        })
        .expect(201);

      expect(response.body.id).toBe(generatorId);
    });

    it('should reject design without natural_language_spec (400)', async () => {
      const response = await request(app)
        .post(`/api/campaigns/${campaignId}/generators/design`)
        .set('Authorization', mockToken)
        .send({
          system_name: 'D&D 5e',
        })
        .expect(400);

      expect(response.body.details || response.body.error).toBeDefined();
    });

    it('should reject design with too long spec (400)', async () => {
      const longSpec = 'a'.repeat(2001);
      const response = await request(app)
        .post(`/api/campaigns/${campaignId}/generators/design`)
        .set('Authorization', mockToken)
        .send({
          natural_language_spec: longSpec,
        })
        .expect(400);

      expect(response.body.details || response.body.error).toBeDefined();
    });

    it('should reject design with empty spec (400)', async () => {
      const response = await request(app)
        .post(`/api/campaigns/${campaignId}/generators/design`)
        .set('Authorization', mockToken)
        .send({
          natural_language_spec: '   ',
        })
        .expect(400);

      expect(response.body.details || response.body.error).toBeDefined();
    });

    it('should handle OpenAI API errors gracefully (400)', async () => {
      const ValidationError = require('../../src/types').ValidationError;
      (generatorDesignerService.designAndCreateGenerator as jest.Mock).mockRejectedValue(
        new ValidationError('Failed to design generator: Rate limit exceeded')
      );

      const response = await request(app)
        .post(`/api/campaigns/${campaignId}/generators/design`)
        .set('Authorization', mockToken)
        .send({
          natural_language_spec: 'Create a generator',
        })
        .expect(400);

      expect(response.body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('Authorization Tests', () => {
    it('should reject all requests without authorization token (401)', async () => {
      (authUtils.verifyAccessToken as jest.Mock).mockImplementation(() => {
        throw new Error('Invalid token');
      });

      // Test all endpoints
      const endpoints = [
        { method: 'get', path: `/api/campaigns/${campaignId}/generators` },
        { method: 'post', path: `/api/campaigns/${campaignId}/generators`, body: {} },
        { method: 'get', path: `/api/campaigns/${campaignId}/generators/${generatorId}` },
        { method: 'put', path: `/api/campaigns/${campaignId}/generators/${generatorId}`, body: {} },
        { method: 'delete', path: `/api/campaigns/${campaignId}/generators/${generatorId}` },
        { method: 'post', path: `/api/campaigns/${campaignId}/generators/${generatorId}/roll`, body: { sessionId } },
        { method: 'get', path: `/api/campaigns/${campaignId}/generators/${generatorId}/rolls` },
        { method: 'get', path: `/api/campaigns/${campaignId}/generators/${generatorId}/statistics` },
        { method: 'post', path: `/api/campaigns/${campaignId}/generators/design`, body: { natural_language_spec: 'test' } },
      ];

      for (const endpoint of endpoints) {
        const req = (request(app) as any)[endpoint.method](endpoint.path);
        if (endpoint.body) {
          req.send(endpoint.body);
        }
        const response = await req.expect(401);
        expect(response.body.code).toBe('UNAUTHORIZED');
      }
    });

    it('should verify campaign ownership on all operations', async () => {
      const ForbiddenError = require('../../src/types').ForbiddenError;
      (generatorService.listGenerators as jest.Mock).mockRejectedValue(
        new ForbiddenError('You do not have permission to access this campaign')
      );

      const response = await request(app)
        .get(`/api/campaigns/${campaignId}/generators`)
        .set('Authorization', mockToken)
        .expect(403);

      expect(response.body.code).toBe('FORBIDDEN');
    });
  });
});
