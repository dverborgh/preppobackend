/**
 * Integration tests for RAG routes
 * Tests all RAG endpoints with mocked services and OpenAI
 *
 * Coverage includes:
 * - POST /campaigns/:campaignId/rag/query - RAG Q&A endpoint
 * - POST /rag/queries/:queryId/feedback - Query feedback
 * - POST /rag/search - Chunk search without LLM
 * - POST /rag/evaluate - Golden questions evaluation
 * - GET /rag/golden-questions - Get golden questions
 * - POST /rag/golden-questions - Create golden question
 */

import request from 'supertest';
import express, { Express } from 'express';
import ragRoutes from '../../src/routes/rag';
import { errorHandler } from '../../src/middleware/errorHandler';
import * as database from '../../src/config/database';
import * as redis from '../../src/config/redis';
import * as ragService from '../../src/services/ragService';
import * as authUtils from '../../src/utils/auth';

// Mock dependencies
jest.mock('../../src/config/database');
jest.mock('../../src/config/redis');
jest.mock('../../src/services/ragService');
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

describe('RAG Routes Integration Tests', () => {
  let app: Express;
  let mockDb: any;
  let mockCache: any;
  const userId = '123e4567-e89b-12d3-a456-426614174000';
  const campaignId = '123e4567-e89b-12d3-a456-426614174001';
  const queryId = '123e4567-e89b-12d3-a456-426614174002';
  const resourceId = '123e4567-e89b-12d3-a456-426614174003';
  const mockToken = 'Bearer mock_token';

  beforeAll(() => {
    // Create Express app
    app = express();
    app.use(express.json());

    // API Router setup
    const apiRouter = express.Router();
    apiRouter.use('/', ragRoutes);

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
      manyOrNone: jest.fn(),
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

  describe('POST /api/campaigns/:campaignId/rag/query', () => {
    const validQuery = 'What are the combat rules for rogues?';

    const mockRAGResponse: ragService.RAGResponse = {
      queryId,
      answer: `Based on the provided excerpts, rogues have the following combat abilities:

1. Sneak Attack: Can deal extra damage when attacking with advantage [Page 42, Rogue Class]
2. Cunning Action: Can take a bonus action to Dash, Disengage, or Hide [Page 42, Rogue Class]
3. Evasion: Can dodge area effects for no damage on successful save [Page 43, Rogue Class]

These are the core combat features that distinguish rogues from other classes.`,
      sources: [
        {
          chunkId: 'chunk-1',
          resourceId: resourceId,
          fileName: 'players-handbook.pdf',
          pageNumber: 42,
          sectionHeading: 'Rogue Class',
          contentPreview: 'Rogues rely on skill, stealth, and their foes vulnerabilities to get the upper hand in any situation. They have a knack for finding...',
          similarityScore: 0.92,
          rank: 1,
        },
        {
          chunkId: 'chunk-2',
          resourceId: resourceId,
          fileName: 'players-handbook.pdf',
          pageNumber: 43,
          sectionHeading: 'Rogue Class',
          contentPreview: 'At 7th level, your instinctive agility lets you dodge out of the way of certain area effects...',
          similarityScore: 0.85,
          rank: 2,
        },
      ],
      metadata: {
        model: 'gpt-4o-mini',
        promptTokens: 320,
        completionTokens: 95,
        latencyMs: 1650,
        searchLatencyMs: 450,
        llmLatencyMs: 1150,
        chunksRetrieved: 2,
        conversationId: 'conv-456',
      },
    };

    beforeEach(() => {
      (ragService.query as jest.Mock).mockResolvedValue(mockRAGResponse);
    });

    it('should successfully query with valid input (200)', async () => {
      const response = await request(app)
        .post(`/api/campaigns/${campaignId}/rag/query`)
        .set('Authorization', mockToken)
        .send({ query: validQuery })
        .expect(200);

      expect(response.body).toEqual(mockRAGResponse);

      // Verify ragService.query was called correctly
      expect(ragService.query).toHaveBeenCalledWith(
        mockDb,
        userId,
        campaignId,
        validQuery,
        {}
      );
    });

    it('should include citations with page numbers and section headings (200)', async () => {
      const response = await request(app)
        .post(`/api/campaigns/${campaignId}/rag/query`)
        .set('Authorization', mockToken)
        .send({ query: validQuery })
        .expect(200);

      expect(response.body.answer).toContain('[Page 42, Rogue Class]');
      expect(response.body.sources).toHaveLength(2);
      expect(response.body.sources[0]).toMatchObject({
        pageNumber: 42,
        sectionHeading: 'Rogue Class',
        fileName: 'players-handbook.pdf',
      });
    });

    it('should respect topK parameter (200)', async () => {
      await request(app)
        .post(`/api/campaigns/${campaignId}/rag/query`)
        .set('Authorization', mockToken)
        .send({
          query: validQuery,
          top_k: 15,
        })
        .expect(200);

      expect(ragService.query).toHaveBeenCalledWith(
        mockDb,
        userId,
        campaignId,
        validQuery,
        { topK: 15 }
      );
    });

    it('should filter by resource IDs when provided (200)', async () => {
      const resourceIds = [resourceId, '123e4567-e89b-12d3-a456-426614174004'];

      await request(app)
        .post(`/api/campaigns/${campaignId}/rag/query`)
        .set('Authorization', mockToken)
        .send({
          query: validQuery,
          resource_ids: resourceIds,
        })
        .expect(200);

      expect(ragService.query).toHaveBeenCalledWith(
        mockDb,
        userId,
        campaignId,
        validQuery,
        { resourceIds }
      );
    });

    it('should use provided conversation ID for multi-turn conversations (200)', async () => {
      const conversationId = '123e4567-e89b-12d3-a456-426614174005';

      await request(app)
        .post(`/api/campaigns/${campaignId}/rag/query`)
        .set('Authorization', mockToken)
        .send({
          query: validQuery,
          conversation_id: conversationId,
        })
        .expect(200);

      expect(ragService.query).toHaveBeenCalledWith(
        mockDb,
        userId,
        campaignId,
        validQuery,
        { conversationId }
      );
    });

    it('should handle all optional parameters together (200)', async () => {
      const conversationId = '123e4567-e89b-12d3-a456-426614174006';
      const resourceIds = [resourceId];

      await request(app)
        .post(`/api/campaigns/${campaignId}/rag/query`)
        .set('Authorization', mockToken)
        .send({
          query: validQuery,
          top_k: 8,
          resource_ids: resourceIds,
          conversation_id: conversationId,
        })
        .expect(200);

      expect(ragService.query).toHaveBeenCalledWith(
        mockDb,
        userId,
        campaignId,
        validQuery,
        {
          topK: 8,
          resourceIds,
          conversationId,
        }
      );
    });

    it('should return response in under 2 seconds (performance check)', async () => {
      const startTime = Date.now();

      const response = await request(app)
        .post(`/api/campaigns/${campaignId}/rag/query`)
        .set('Authorization', mockToken)
        .send({ query: validQuery })
        .expect(200);

      const duration = Date.now() - startTime;

      // API should respond quickly (mocked, so < 100ms)
      expect(duration).toBeLessThan(2000);

      // Metadata should show latency under 2s
      expect(response.body.metadata.latencyMs).toBeLessThan(2000);
    });

    it('should handle query with no chunks found (200)', async () => {
      const emptyResponse: ragService.RAGResponse = {
        queryId,
        answer: "I don't have that information in the provided materials. You might want to check the GM guide or ask your GM to clarify this rule.",
        sources: [],
        metadata: {
          model: 'gpt-4o-mini',
          promptTokens: 100,
          completionTokens: 30,
          latencyMs: 800,
          searchLatencyMs: 200,
          llmLatencyMs: 550,
          chunksRetrieved: 0,
        },
      };

      (ragService.query as jest.Mock).mockResolvedValue(emptyResponse);

      const response = await request(app)
        .post(`/api/campaigns/${campaignId}/rag/query`)
        .set('Authorization', mockToken)
        .send({ query: 'What is the airspeed velocity of an unladen swallow?' })
        .expect(200);

      expect(response.body.sources).toHaveLength(0);
      expect(response.body.answer).toContain("don't have that information");
    });

    it('should reject query too short (400)', async () => {
      const response = await request(app)
        .post(`/api/campaigns/${campaignId}/rag/query`)
        .set('Authorization', mockToken)
        .send({ query: 'Rogue?' })
        .expect(400);

      expect(response.body.error).toBe('Validation failed');
      expect(response.body.details.fields.query).toContain('between 10 and 500');
    });

    it('should reject query too long (400)', async () => {
      const longQuery = 'A'.repeat(501);

      const response = await request(app)
        .post(`/api/campaigns/${campaignId}/rag/query`)
        .set('Authorization', mockToken)
        .send({ query: longQuery })
        .expect(400);

      expect(response.body.error).toBe('Validation failed');
    });

    it('should reject missing query field (400)', async () => {
      const response = await request(app)
        .post(`/api/campaigns/${campaignId}/rag/query`)
        .set('Authorization', mockToken)
        .send({})
        .expect(400);

      expect(response.body.error).toBe('Validation failed');
    });

    it('should reject invalid campaign ID (400)', async () => {
      await request(app)
        .post('/api/campaigns/invalid-uuid/rag/query')
        .set('Authorization', mockToken)
        .send({ query: validQuery })
        .expect(400);
    });

    it('should reject invalid resource IDs (400)', async () => {
      const response = await request(app)
        .post(`/api/campaigns/${campaignId}/rag/query`)
        .set('Authorization', mockToken)
        .send({
          query: validQuery,
          resource_ids: ['not-a-uuid', 'also-not-uuid'],
        })
        .expect(400);

      expect(response.body.error).toBe('Validation failed');
    });

    it('should reject invalid top_k value (400)', async () => {
      await request(app)
        .post(`/api/campaigns/${campaignId}/rag/query`)
        .set('Authorization', mockToken)
        .send({
          query: validQuery,
          top_k: 0, // Invalid: must be >= 1
        })
        .expect(400);

      await request(app)
        .post(`/api/campaigns/${campaignId}/rag/query`)
        .set('Authorization', mockToken)
        .send({
          query: validQuery,
          top_k: 21, // Invalid: must be <= 20
        })
        .expect(400);
    });

    it('should reject invalid conversation_id (400)', async () => {
      await request(app)
        .post(`/api/campaigns/${campaignId}/rag/query`)
        .set('Authorization', mockToken)
        .send({
          query: validQuery,
          conversation_id: 'not-a-uuid',
        })
        .expect(400);
    });

    it('should reject request without authorization (401)', async () => {
      (authUtils.extractTokenFromHeader as jest.Mock).mockImplementation(() => {
        const UnauthorizedError = require('../../src/types').UnauthorizedError;
        throw new UnauthorizedError('No authorization header');
      });

      await request(app)
        .post(`/api/campaigns/${campaignId}/rag/query`)
        .send({ query: validQuery })
        .expect(401);

      // Restore mock
      (authUtils.extractTokenFromHeader as jest.Mock).mockReturnValue('mock_token');
    });

    it('should reject request with blacklisted token (401)', async () => {
      (mockCache.isTokenBlacklisted as jest.Mock).mockResolvedValue(true);

      await request(app)
        .post(`/api/campaigns/${campaignId}/rag/query`)
        .set('Authorization', mockToken)
        .send({ query: validQuery })
        .expect(401);
    });

    it('should reject access to campaign not owned by user (403)', async () => {
      const ForbiddenError = require('../../src/types').ForbiddenError;
      (ragService.query as jest.Mock).mockRejectedValue(
        new ForbiddenError('You do not have permission to access this campaign')
      );

      const response = await request(app)
        .post(`/api/campaigns/${campaignId}/rag/query`)
        .set('Authorization', mockToken)
        .send({ query: validQuery })
        .expect(403);

      expect(response.body.code).toBe('FORBIDDEN');
    });
  });

  describe('POST /api/rag/queries/:queryId/feedback', () => {
    beforeEach(() => {
      // Mock query ownership check
      mockDb.oneOrNone.mockResolvedValue({ user_id: userId });
      mockDb.none.mockResolvedValue(undefined);
    });

    it('should successfully submit feedback with rating and comment (204)', async () => {
      await request(app)
        .post(`/api/rag/queries/${queryId}/feedback`)
        .set('Authorization', mockToken)
        .send({
          rating: 5,
          comment: 'Very helpful answer with clear citations!',
        })
        .expect(204);

      // Verify database update
      expect(mockDb.none).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE rag_queries'),
        [5, 'Very helpful answer with clear citations!', queryId]
      );
    });

    it('should allow feedback without comment (204)', async () => {
      await request(app)
        .post(`/api/rag/queries/${queryId}/feedback`)
        .set('Authorization', mockToken)
        .send({ rating: 4 })
        .expect(204);

      expect(mockDb.none).toHaveBeenCalledWith(
        expect.any(String),
        [4, null, queryId]
      );
    });

    it('should accept all valid ratings 1-5 (204)', async () => {
      for (let rating = 1; rating <= 5; rating++) {
        await request(app)
          .post(`/api/rag/queries/${queryId}/feedback`)
          .set('Authorization', mockToken)
          .send({ rating })
          .expect(204);
      }

      expect(mockDb.none).toHaveBeenCalledTimes(5);
    });

    it('should reject rating below 1 (400)', async () => {
      await request(app)
        .post(`/api/rag/queries/${queryId}/feedback`)
        .set('Authorization', mockToken)
        .send({ rating: 0 })
        .expect(400);
    });

    it('should reject rating above 5 (400)', async () => {
      await request(app)
        .post(`/api/rag/queries/${queryId}/feedback`)
        .set('Authorization', mockToken)
        .send({ rating: 6 })
        .expect(400);
    });

    it('should reject missing rating (400)', async () => {
      await request(app)
        .post(`/api/rag/queries/${queryId}/feedback`)
        .set('Authorization', mockToken)
        .send({ comment: 'Good answer' })
        .expect(400);
    });

    it('should reject comment too long (400)', async () => {
      const longComment = 'A'.repeat(501);

      await request(app)
        .post(`/api/rag/queries/${queryId}/feedback`)
        .set('Authorization', mockToken)
        .send({
          rating: 3,
          comment: longComment,
        })
        .expect(400);
    });

    it('should reject invalid query ID (400)', async () => {
      await request(app)
        .post('/api/rag/queries/invalid-uuid/feedback')
        .set('Authorization', mockToken)
        .send({ rating: 5 })
        .expect(400);
    });

    it('should return 404 for non-existent query', async () => {
      mockDb.oneOrNone.mockResolvedValue(null);

      const response = await request(app)
        .post(`/api/rag/queries/${queryId}/feedback`)
        .set('Authorization', mockToken)
        .send({ rating: 5 })
        .expect(404);

      expect(response.body.error).toBe('Query not found');
    });

    it('should reject when user does not own query (403)', async () => {
      mockDb.oneOrNone.mockResolvedValue({ user_id: 'different-user-id' });

      const response = await request(app)
        .post(`/api/rag/queries/${queryId}/feedback`)
        .set('Authorization', mockToken)
        .send({ rating: 5 })
        .expect(403);

      expect(response.body.error).toContain('own queries');
    });

    it('should reject request without authorization (401)', async () => {
      (authUtils.extractTokenFromHeader as jest.Mock).mockImplementation(() => {
        const UnauthorizedError = require('../../src/types').UnauthorizedError;
        throw new UnauthorizedError('No authorization header');
      });

      await request(app)
        .post(`/api/rag/queries/${queryId}/feedback`)
        .send({ rating: 5 })
        .expect(401);

      // Restore mock
      (authUtils.extractTokenFromHeader as jest.Mock).mockReturnValue('mock_token');
    });
  });

  describe('POST /api/search (Not Implemented)', () => {
    it('should return 501 not implemented', async () => {
      const response = await request(app)
        .post('/api/search')
        .set('Authorization', mockToken)
        .send({
          query: 'test search',
          campaignId,
        })
        .expect(501);

      expect(response.body.message).toContain('not implemented');
      expect(response.body.endpoint).toBe('POST /rag/search');
      expect(response.body.note).toContain('relevant resource chunks');
    });

    it('should not require authentication for 501 response', async () => {
      const response = await request(app)
        .post('/api/search')
        .send({})
        .expect(501);

      expect(response.body.message).toContain('not implemented');
    });
  });

  describe('POST /api/evaluate (Not Implemented)', () => {
    it('should return 501 not implemented', async () => {
      const response = await request(app)
        .post('/api/evaluate')
        .set('Authorization', mockToken)
        .send({
          campaignId,
        })
        .expect(501);

      expect(response.body.message).toContain('not implemented');
      expect(response.body.endpoint).toBe('POST /rag/evaluate');
      expect(response.body.note).toContain('golden question');
    });

    it('should not require authentication for 501 response', async () => {
      const response = await request(app)
        .post('/api/evaluate')
        .send({})
        .expect(501);

      expect(response.body.message).toContain('not implemented');
    });
  });

  describe('GET /api/golden-questions (Not Implemented)', () => {
    it('should return 501 not implemented', async () => {
      const response = await request(app)
        .get('/api/golden-questions')
        .set('Authorization', mockToken)
        .query({ campaignId })
        .expect(501);

      expect(response.body.message).toContain('not implemented');
      expect(response.body.endpoint).toBe('GET /rag/golden-questions');
    });

    it('should not require authentication for 501 response', async () => {
      const response = await request(app)
        .get('/api/golden-questions')
        .expect(501);

      expect(response.body.message).toContain('not implemented');
    });

    it('should include query parameters in response', async () => {
      const response = await request(app)
        .get('/api/golden-questions')
        .set('Authorization', mockToken)
        .query({ campaignId, status: 'active' })
        .expect(501);

      expect(response.body.query).toEqual({
        campaignId,
        status: 'active',
      });
    });
  });

  describe('POST /api/golden-questions (Not Implemented)', () => {
    it('should return 501 not implemented', async () => {
      const response = await request(app)
        .post('/api/golden-questions')
        .set('Authorization', mockToken)
        .send({
          campaignId,
          question: 'What are the rules for stealth?',
          expected_answer: 'Rogues get advantage on stealth checks...',
        })
        .expect(501);

      expect(response.body.message).toContain('not implemented');
      expect(response.body.endpoint).toBe('POST /rag/golden-questions');
    });

    it('should not require authentication for 501 response', async () => {
      const response = await request(app)
        .post('/api/golden-questions')
        .send({})
        .expect(501);

      expect(response.body.message).toContain('not implemented');
    });
  });

  describe('Rate Limiting (Development Mode)', () => {
    it('should not be rate limited in development mode', async () => {
      // Set development mode
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      const validQuery = 'What are the combat rules for rogues?';

      // Reset the mock to return successful RAG response for all calls
      (ragService.query as jest.Mock).mockResolvedValue({
        queryId,
        answer: 'Test answer',
        sources: [],
        metadata: {
          model: 'gpt-4o-mini',
          promptTokens: 100,
          completionTokens: 50,
          latencyMs: 500,
          searchLatencyMs: 200,
          llmLatencyMs: 300,
          chunksRetrieved: 0,
        },
      });

      // Make 10 rapid requests
      const promises = Array.from({ length: 10 }, () =>
        request(app)
          .post(`/api/campaigns/${campaignId}/rag/query`)
          .set('Authorization', mockToken)
          .send({ query: validQuery })
      );

      const responses = await Promise.all(promises);

      // All should succeed (no rate limiting)
      responses.forEach((response) => {
        expect(response.status).toBe(200);
      });

      // Restore original NODE_ENV
      if (originalEnv !== undefined) {
        process.env.NODE_ENV = originalEnv;
      } else {
        delete process.env.NODE_ENV;
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors gracefully (500)', async () => {
      const validQuery = 'What are the combat rules?';
      (ragService.query as jest.Mock).mockRejectedValue(new Error('Database connection failed'));

      const response = await request(app)
        .post(`/api/campaigns/${campaignId}/rag/query`)
        .set('Authorization', mockToken)
        .send({ query: validQuery })
        .expect(500);

      expect(response.body.error).toBeDefined();
    });

    it('should handle OpenAI API errors gracefully (500)', async () => {
      const validQuery = 'What are the combat rules?';
      (ragService.query as jest.Mock).mockRejectedValue(
        new Error('Failed to generate answer: Rate limit exceeded')
      );

      const response = await request(app)
        .post(`/api/campaigns/${campaignId}/rag/query`)
        .set('Authorization', mockToken)
        .send({ query: validQuery })
        .expect(500);

      expect(response.body.error).toBeDefined();
    });
  });

  describe('Authorization Tests', () => {
    it('should verify campaign ownership on all operations', async () => {
      const ForbiddenError = require('../../src/types').ForbiddenError;
      (ragService.query as jest.Mock).mockRejectedValue(
        new ForbiddenError('You do not have permission to access this campaign')
      );

      const response = await request(app)
        .post(`/api/campaigns/${campaignId}/rag/query`)
        .set('Authorization', mockToken)
        .send({ query: 'What are the rules?' })
        .expect(403);

      expect(response.body.code).toBe('FORBIDDEN');
    });

    it('should verify query ownership on feedback submission', async () => {
      mockDb.oneOrNone.mockResolvedValue({ user_id: 'other-user-id' });

      const response = await request(app)
        .post(`/api/rag/queries/${queryId}/feedback`)
        .set('Authorization', mockToken)
        .send({ rating: 5 })
        .expect(403);

      expect(response.body.code).toBe('FORBIDDEN');
    });
  });
});
