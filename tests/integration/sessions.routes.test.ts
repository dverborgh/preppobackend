/**
 * Integration tests for session routes
 * Tests all session endpoints with mocked database and authentication
 */

import request from 'supertest';
import express, { Express } from 'express';
import campaignRoutes from '../../src/routes/campaigns';
import { errorHandler } from '../../src/middleware/errorHandler';
import * as database from '../../src/config/database';
import * as redis from '../../src/config/redis';
import * as sessionService from '../../src/services/sessionService';
import * as authUtils from '../../src/utils/auth';

// Mock dependencies
jest.mock('../../src/config/database');
jest.mock('../../src/config/redis');
jest.mock('../../src/services/sessionService');
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

describe('Session Routes Integration Tests', () => {
  let app: Express;
  let mockDb: any;
  let mockCache: any;
  const userId = '123e4567-e89b-12d3-a456-426614174000';
  const campaignId = '123e4567-e89b-12d3-a456-426614174001';
  const sessionId = '123e4567-e89b-12d3-a456-426614174002';
  const mockToken = 'Bearer mock_token';

  beforeAll(() => {
    // Create Express app with campaign routes (which includes nested session routes)
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
  });

  describe('POST /api/campaigns/:campaignId/sessions', () => {
    it('should create session with valid data (201)', async () => {
      const mockSession = {
        id: sessionId,
        campaign_id: campaignId,
        session_number: 1,
        name: 'The Awakening',
        scheduled_date: '2025-12-15',
        description: 'Party wakes in tavern',
        notes: null,
        duration_minutes: null,
        status: 'draft',
        created_at: new Date(),
        updated_at: new Date(),
        preparation_notes: 'Prepare NPCs',
        gm_objectives: ['Introduce villain'],
        is_active: false,
        started_at: null,
      };

      (sessionService.createSession as jest.Mock).mockResolvedValue(mockSession);

      const response = await request(app)
        .post(`/api/campaigns/${campaignId}/sessions`)
        .set('Authorization', mockToken)
        .send({
          session_number: 1,
          name: 'The Awakening',
          scheduled_date: '2025-12-15',
          description: 'Party wakes in tavern',
          preparation_notes: 'Prepare NPCs',
          gm_objectives: ['Introduce villain'],
        });

      if (response.status !== 201) {
        console.log('Error response:', response.body);
      }
      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        id: sessionId,
        name: 'The Awakening',
        status: 'draft',
      });
      expect(sessionService.createSession).toHaveBeenCalledWith(
        mockDb,
        userId,
        campaignId,
        expect.objectContaining({
          session_number: 1,
          name: 'The Awakening',
        })
      );
    });

    it('should return 400 for missing required fields', async () => {
      const response = await request(app)
        .post(`/api/campaigns/${campaignId}/sessions`)
        .set('Authorization', mockToken)
        .send({
          session_number: 1,
          // Missing name
        });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for invalid session_number', async () => {
      const response = await request(app)
        .post(`/api/campaigns/${campaignId}/sessions`)
        .set('Authorization', mockToken)
        .send({
          session_number: 0,
          name: 'Test Session',
        });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    // Note: Authentication is enforced by the parent campaign route and authenticate middleware
    // which is tested in the auth middleware unit tests and campaign routes integration tests
  });

  describe('GET /api/campaigns/:campaignId/sessions', () => {
    it('should list sessions with default pagination (200)', async () => {
      const mockSessions = [
        {
          id: sessionId,
          campaign_id: campaignId,
          session_number: 1,
          name: 'Session 1',
          status: 'planned',
          scheduled_date: '2025-12-15',
          created_at: new Date(),
          updated_at: new Date(),
          is_active: false,
          scene_count: 3,
        },
      ];

      (sessionService.getSessions as jest.Mock).mockResolvedValue({
        data: mockSessions,
        total: 1,
        skip: 0,
        limit: 50,
      });

      const response = await request(app)
        .get(`/api/campaigns/${campaignId}/sessions`)
        .set('Authorization', mockToken);

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.total).toBe(1);
    });

    it('should filter sessions by status', async () => {
      (sessionService.getSessions as jest.Mock).mockResolvedValue({
        data: [],
        total: 0,
        skip: 0,
        limit: 50,
      });

      const response = await request(app)
        .get(`/api/campaigns/${campaignId}/sessions?status=draft`)
        .set('Authorization', mockToken);

      expect(response.status).toBe(200);
      expect(sessionService.getSessions).toHaveBeenCalledWith(
        mockDb,
        userId,
        campaignId,
        expect.objectContaining({ status: 'draft' })
      );
    });

    it('should apply pagination parameters', async () => {
      (sessionService.getSessions as jest.Mock).mockResolvedValue({
        data: [],
        total: 0,
        skip: 10,
        limit: 25,
      });

      const response = await request(app)
        .get(`/api/campaigns/${campaignId}/sessions?skip=10&limit=25`)
        .set('Authorization', mockToken);

      expect(response.status).toBe(200);
      expect(sessionService.getSessions).toHaveBeenCalledWith(
        mockDb,
        userId,
        campaignId,
        expect.objectContaining({ skip: 10, limit: 25 })
      );
    });

    it('should return 400 for invalid status filter', async () => {
      const response = await request(app)
        .get(`/api/campaigns/${campaignId}/sessions?status=invalid`)
        .set('Authorization', mockToken);

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/campaigns/:campaignId/sessions/:id', () => {
    it('should return session with counts (200)', async () => {
      const mockSession = {
        id: sessionId,
        campaign_id: campaignId,
        session_number: 1,
        name: 'Test Session',
        status: 'planned',
        description: 'Description',
        scheduled_date: '2025-12-15',
        notes: null,
        duration_minutes: 240,
        gm_objectives: ['Objective 1'],
        preparation_notes: 'Notes',
        created_at: new Date(),
        updated_at: new Date(),
        is_active: false,
        started_at: null,
        scene_count: 3,
        packet_count: 1,
      };

      (sessionService.getSessionById as jest.Mock).mockResolvedValue(mockSession);

      const response = await request(app)
        .get(`/api/campaigns/${campaignId}/sessions/${sessionId}`)
        .set('Authorization', mockToken);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        id: sessionId,
        name: 'Test Session',
        scene_count: 3,
        packet_count: 1,
      });
    });

    it('should return 404 for non-existent session', async () => {
      const NotFoundError = require('../../src/types').NotFoundError;
      (sessionService.getSessionById as jest.Mock).mockRejectedValue(
        new NotFoundError('Session')
      );

      const response = await request(app)
        .get(`/api/campaigns/${campaignId}/sessions/${sessionId}`)
        .set('Authorization', mockToken);

      expect(response.status).toBe(404);
    });

    it('should return 400 for invalid session UUID', async () => {
      const response = await request(app)
        .get(`/api/campaigns/${campaignId}/sessions/invalid-uuid`)
        .set('Authorization', mockToken);

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('PUT /api/campaigns/:campaignId/sessions/:id', () => {
    it('should update session (200)', async () => {
      const updatedSession = {
        id: sessionId,
        campaign_id: campaignId,
        session_number: 1,
        name: 'Updated Session',
        status: 'planned',
        description: 'Updated description',
        scheduled_date: null,
        notes: null,
        duration_minutes: null,
        gm_objectives: [],
        preparation_notes: null,
        created_at: new Date(),
        updated_at: new Date(),
        is_active: false,
        started_at: null,
      };

      (sessionService.updateSession as jest.Mock).mockResolvedValue(updatedSession);

      const response = await request(app)
        .put(`/api/campaigns/${campaignId}/sessions/${sessionId}`)
        .set('Authorization', mockToken)
        .send({
          name: 'Updated Session',
          status: 'planned',
        });

      expect(response.status).toBe(200);
      expect(response.body.name).toBe('Updated Session');
      expect(sessionService.updateSession).toHaveBeenCalledWith(
        mockDb,
        userId,
        campaignId,
        sessionId,
        expect.objectContaining({ name: 'Updated Session' })
      );
    });

    it('should return 400 for invalid status transition', async () => {
      const ValidationError = require('../../src/types').ValidationError;
      (sessionService.updateSession as jest.Mock).mockRejectedValue(
        new ValidationError('Invalid status transition')
      );

      const response = await request(app)
        .put(`/api/campaigns/${campaignId}/sessions/${sessionId}`)
        .set('Authorization', mockToken)
        .send({
          status: 'completed',
        });

      expect(response.status).toBe(400);
    });

    it('should return 404 for non-existent session', async () => {
      const NotFoundError = require('../../src/types').NotFoundError;
      (sessionService.updateSession as jest.Mock).mockRejectedValue(
        new NotFoundError('Session')
      );

      const response = await request(app)
        .put(`/api/campaigns/${campaignId}/sessions/${sessionId}`)
        .set('Authorization', mockToken)
        .send({ name: 'Test' });

      expect(response.status).toBe(404);
    });
  });

  describe('DELETE /api/campaigns/:campaignId/sessions/:id', () => {
    it('should delete session (204)', async () => {
      (sessionService.deleteSession as jest.Mock).mockResolvedValue(undefined);

      const response = await request(app)
        .delete(`/api/campaigns/${campaignId}/sessions/${sessionId}`)
        .set('Authorization', mockToken);

      expect(response.status).toBe(204);
      expect(sessionService.deleteSession).toHaveBeenCalledWith(
        mockDb,
        userId,
        campaignId,
        sessionId
      );
    });

    it('should return 404 for non-existent session', async () => {
      const NotFoundError = require('../../src/types').NotFoundError;
      (sessionService.deleteSession as jest.Mock).mockRejectedValue(
        new NotFoundError('Session')
      );

      const response = await request(app)
        .delete(`/api/campaigns/${campaignId}/sessions/${sessionId}`)
        .set('Authorization', mockToken);

      expect(response.status).toBe(404);
    });
  });

  describe('POST /api/campaigns/:campaignId/sessions/:id/activate', () => {
    it('should activate session (200)', async () => {
      const activatedSession = {
        id: sessionId,
        campaign_id: campaignId,
        session_number: 1,
        name: 'Test Session',
        status: 'in-progress',
        scheduled_date: null,
        description: null,
        notes: null,
        duration_minutes: null,
        gm_objectives: [],
        preparation_notes: null,
        created_at: new Date(),
        updated_at: new Date(),
        is_active: true,
        started_at: new Date(),
      };

      (sessionService.activateSession as jest.Mock).mockResolvedValue(activatedSession);

      const response = await request(app)
        .post(`/api/campaigns/${campaignId}/sessions/${sessionId}/activate`)
        .set('Authorization', mockToken)
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.is_active).toBe(true);
      expect(response.body.status).toBe('in-progress');
      expect(sessionService.activateSession).toHaveBeenCalledWith(
        mockDb,
        userId,
        campaignId,
        sessionId
      );
    });

    it('should return 404 for non-existent session', async () => {
      const NotFoundError = require('../../src/types').NotFoundError;
      (sessionService.activateSession as jest.Mock).mockRejectedValue(
        new NotFoundError('Session')
      );

      const response = await request(app)
        .post(`/api/campaigns/${campaignId}/sessions/${sessionId}/activate`)
        .set('Authorization', mockToken)
        .send({});

      expect(response.status).toBe(404);
    });

    it('should return 403 for unauthorized campaign access', async () => {
      const ForbiddenError = require('../../src/types').ForbiddenError;
      (sessionService.activateSession as jest.Mock).mockRejectedValue(
        new ForbiddenError()
      );

      const response = await request(app)
        .post(`/api/campaigns/${campaignId}/sessions/${sessionId}/activate`)
        .set('Authorization', mockToken)
        .send({});

      expect(response.status).toBe(403);
    });
  });

  describe('POST /api/campaigns/:campaignId/sessions/:sessionId/deactivate', () => {
    it('should deactivate a session successfully', async () => {
      const mockSession = {
        id: sessionId,
        campaign_id: campaignId,
        is_active: false,
      };

      (sessionService.deactivateSession as jest.Mock).mockResolvedValue(mockSession);

      const response = await request(app)
        .post(`/api/campaigns/${campaignId}/sessions/${sessionId}/deactivate`)
        .set('Authorization', mockToken)
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.is_active).toBe(false);
      expect(sessionService.deactivateSession).toHaveBeenCalledWith(
        mockDb,
        userId,
        campaignId,
        sessionId
      );
    });

    it('should return 404 for non-existent session', async () => {
      const NotFoundError = require('../../src/types').NotFoundError;
      (sessionService.deactivateSession as jest.Mock).mockRejectedValue(
        new NotFoundError('Session')
      );

      const response = await request(app)
        .post(`/api/campaigns/${campaignId}/sessions/${sessionId}/deactivate`)
        .set('Authorization', mockToken)
        .send({});

      expect(response.status).toBe(404);
    });
  });

  // Note: Authentication and authorization testing for sessions inherits from campaign routes
  // and is comprehensively tested in auth middleware unit tests and campaign integration tests
});
