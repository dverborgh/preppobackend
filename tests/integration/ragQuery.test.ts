/**
 * Integration tests for RAG query routes
 * Tests full RAG pipeline with mocked dependencies
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

describe('RAG Query Routes Integration Tests', () => {
  let app: Express;
  let mockDb: any;
  let mockCache: any;
  const userId = '123e4567-e89b-12d3-a456-426614174000';
  const campaignId = '123e4567-e89b-12d3-a456-426614174001';
  const queryId = '123e4567-e89b-12d3-a456-426614174002';
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
    (authUtils.extractTokenFromHeader as jest.Mock).mockImplementation((authHeader) => {
      if (!authHeader) {
        throw new (require('../../src/types').UnauthorizedError)('No authorization header');
      }
      return 'mock_token';
    });
    (authUtils.verifyAccessToken as jest.Mock).mockReturnValue({
      sub: userId,
      email: 'test@example.com',
      iat: Date.now(),
      exp: Date.now() + 86400,
      iss: 'preppo.example.com',
    });
  });

  describe('POST /api/campaigns/:campaignId/rag/query', () => {
    const validQuery = 'What are the unbreakable rules for the Fox?';

    const mockRAGResponse: ragService.RAGResponse = {
      queryId,
      answer: `Based on the excerpts, the Fox has three unbreakable rules:

1. Must answer direct questions truthfully [Page 2, FOX]
2. Must accept any gift offered with good intentions [Page 2, FOX]
3. Must honor invitations from invited guests [Page 2, FOX]

These rules are binding constraints on the Fox character.`,
      sources: [
        {
          chunkId: 'chunk-1',
          resourceId: 'resource-1',
          fileName: 'booklet.pdf',
          pageNumber: 2,
          sectionHeading: 'FOX',
          contentPreview: 'The Fox is bound by three unbreakable rules. First, they must answer any direct question truthfully, no matter how inconvenient...',
          similarityScore: 0.95,
          rank: 1,
        },
        {
          chunkId: 'chunk-2',
          resourceId: 'resource-1',
          fileName: 'booklet.pdf',
          pageNumber: 2,
          sectionHeading: 'FOX',
          contentPreview: 'The second rule states that the Fox must accept any gift offered with good intentions...',
          similarityScore: 0.88,
          rank: 2,
        },
      ],
      metadata: {
        model: 'gpt-4o-mini',
        promptTokens: 250,
        completionTokens: 75,
        latencyMs: 1450,
        searchLatencyMs: 350,
        llmLatencyMs: 1050,
        chunksRetrieved: 2,
        conversationId: 'conv-123',
      },
    };

    beforeEach(() => {
      (ragService.query as jest.Mock).mockResolvedValue(mockRAGResponse);
    });

    it('should successfully query with valid input', async () => {
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

    it('should include citations with page numbers and section headings', async () => {
      const response = await request(app)
        .post(`/api/campaigns/${campaignId}/rag/query`)
        .set('Authorization', mockToken)
        .send({ query: validQuery })
        .expect(200);

      expect(response.body.answer).toContain('[Page 2, FOX]');
      expect(response.body.sources).toHaveLength(2);
      expect(response.body.sources[0]).toMatchObject({
        pageNumber: 2,
        sectionHeading: 'FOX',
        fileName: 'booklet.pdf',
      });
    });

    it('should respect topK parameter', async () => {
      await request(app)
        .post(`/api/campaigns/${campaignId}/rag/query`)
        .set('Authorization', mockToken)
        .send({
          query: validQuery,
          top_k: 5,
        })
        .expect(200);

      expect(ragService.query).toHaveBeenCalledWith(
        mockDb,
        userId,
        campaignId,
        validQuery,
        { topK: 5 }
      );
    });

    it('should filter by resource IDs when provided', async () => {
      const resourceIds = [
        '123e4567-e89b-12d3-a456-426614174010',
        '123e4567-e89b-12d3-a456-426614174011',
      ];

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

    it('should use provided conversation ID for multi-turn conversations', async () => {
      const conversationId = '123e4567-e89b-12d3-a456-426614174020';

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

    it('should return response in under 2 seconds', async () => {
      const startTime = Date.now();

      const response = await request(app)
        .post(`/api/campaigns/${campaignId}/rag/query`)
        .set('Authorization', mockToken)
        .send({ query: validQuery })
        .expect(200);

      const duration = Date.now() - startTime;

      // API should respond quickly (mocked, so < 100ms)
      expect(duration).toBeLessThan(2000);

      // Metadata should show latency
      expect(response.body.metadata.latencyMs).toBeLessThan(2000);
    });

    it('should return 400 for query too short', async () => {
      const response = await request(app)
        .post(`/api/campaigns/${campaignId}/rag/query`)
        .set('Authorization', mockToken)
        .send({ query: 'Fox?' })
        .expect(400);

      expect(response.body.error).toBe('Validation failed');
      expect(response.body.details.fields.query).toContain('between 10 and 500');
    });

    it('should return 400 for query too long', async () => {
      const longQuery = 'A'.repeat(501);

      const response = await request(app)
        .post(`/api/campaigns/${campaignId}/rag/query`)
        .set('Authorization', mockToken)
        .send({ query: longQuery })
        .expect(400);

      expect(response.body.error).toBe('Validation failed');
    });

    it('should return 400 for invalid campaign ID', async () => {
      await request(app)
        .post('/api/campaigns/invalid-uuid/rag/query')
        .set('Authorization', mockToken)
        .send({ query: validQuery })
        .expect(400);
    });

    it('should return 400 for invalid resource IDs', async () => {
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

    it('should return 400 for invalid top_k', async () => {
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
          top_k: 25, // Invalid: must be <= 20
        })
        .expect(400);
    });

    it('should return 401 when not authenticated', async () => {
      (mockCache.isTokenBlacklisted as jest.Mock).mockResolvedValue(true);

      await request(app)
        .post(`/api/campaigns/${campaignId}/rag/query`)
        .set('Authorization', mockToken)
        .send({ query: validQuery })
        .expect(401);
    });

    it('should return 401 for missing authorization header', async () => {
      await request(app)
        .post(`/api/campaigns/${campaignId}/rag/query`)
        .send({ query: validQuery })
        .expect(401);
    });
  });

  describe('POST /api/rag/queries/:queryId/feedback', () => {
    beforeEach(() => {
      // Mock query ownership check
      mockDb.oneOrNone.mockResolvedValue({ user_id: userId });
      mockDb.none.mockResolvedValue(undefined);
    });

    it('should successfully submit feedback', async () => {
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

    it('should allow feedback without comment', async () => {
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

    it('should return 400 for invalid rating', async () => {
      await request(app)
        .post(`/api/rag/queries/${queryId}/feedback`)
        .set('Authorization', mockToken)
        .send({ rating: 0 })
        .expect(400);

      await request(app)
        .post(`/api/rag/queries/${queryId}/feedback`)
        .set('Authorization', mockToken)
        .send({ rating: 6 })
        .expect(400);
    });

    it('should return 400 for comment too long', async () => {
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

    it('should return 404 for non-existent query', async () => {
      mockDb.oneOrNone.mockResolvedValue(null);

      const response = await request(app)
        .post(`/api/rag/queries/${queryId}/feedback`)
        .set('Authorization', mockToken)
        .send({ rating: 5 })
        .expect(404);

      expect(response.body.error).toBe('Query not found');
    });

    it('should return 403 when user does not own query', async () => {
      mockDb.oneOrNone.mockResolvedValue({ user_id: 'different-user-id' });

      const response = await request(app)
        .post(`/api/rag/queries/${queryId}/feedback`)
        .set('Authorization', mockToken)
        .send({ rating: 5 })
        .expect(403);

      expect(response.body.error).toContain('own queries');
    });

    it('should return 401 when not authenticated', async () => {
      await request(app)
        .post(`/api/rag/queries/${queryId}/feedback`)
        .send({ rating: 5 })
        .expect(401);
    });
  });
});
