/**
 * Unit tests for soundboard routes
 * Tests all soundboard endpoints for proper 501 responses
 */

import request from 'supertest';
import express, { Express } from 'express';
import soundboardRouter from '../../../src/routes/soundboard';
import { authenticate } from '../../../src/middleware/auth';

// Mock dependencies
jest.mock('../../../src/middleware/auth', () => ({
  authenticate: jest.fn((req, _res, next) => {
    req.user = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      email: 'test@example.com',
    };
    next();
  }),
}));

describe('Soundboard Routes', () => {
  let app: Express;

  beforeEach(() => {
    jest.clearAllMocks();

    app = express();
    app.use(express.json());
    app.use('/soundboard', soundboardRouter);
  });

  describe('GET /soundboard/session/:sessionId', () => {
    it('should return 501 not implemented', async () => {
      const sessionId = '550e8400-e29b-41d4-a716-446655440000';

      const response = await request(app).get(`/soundboard/session/${sessionId}`);

      expect(response.status).toBe(501);
      expect(response.body).toEqual({
        message: 'Get session soundboard not implemented yet',
        endpoint: 'GET /soundboard/session/:sessionId',
        sessionId,
        note: 'Returns scenes with associated tracks for soundboard UI',
      });
    });

    it('should require authentication', async () => {
      (authenticate as jest.Mock).mockImplementationOnce((_req, res) => {
        res.status(401).json({ error: 'Unauthorized' });
      });

      const response = await request(app).get('/soundboard/session/test-id');

      expect(response.status).toBe(401);
    });
  });

  describe('POST /soundboard/session/:sessionId/active-scene', () => {
    it('should return 501 not implemented', async () => {
      const sessionId = '550e8400-e29b-41d4-a716-446655440000';

      const response = await request(app)
        .post(`/soundboard/session/${sessionId}/active-scene`)
        .send({ sceneId: 'scene-123' });

      expect(response.status).toBe(501);
      expect(response.body).toEqual({
        message: 'Set active scene not implemented yet',
        endpoint: 'POST /soundboard/session/:sessionId/active-scene',
        sessionId,
      });
    });

    it('should require authentication', async () => {
      (authenticate as jest.Mock).mockImplementationOnce((_req, res) => {
        res.status(401).json({ error: 'Unauthorized' });
      });

      const response = await request(app)
        .post('/soundboard/session/test-id/active-scene')
        .send({ sceneId: 'scene-123' });

      expect(response.status).toBe(401);
    });
  });

  describe('GET /soundboard/track/:trackId/stream', () => {
    it('should return 501 not implemented', async () => {
      const trackId = '660e8400-e29b-41d4-a716-446655440000';

      const response = await request(app).get(`/soundboard/track/${trackId}/stream`);

      expect(response.status).toBe(501);
      expect(response.body).toEqual({
        message: 'Stream track not implemented yet',
        endpoint: 'GET /soundboard/track/:trackId/stream',
        trackId,
        note: 'Will stream audio file from S3 storage',
      });
    });

    it('should require authentication', async () => {
      (authenticate as jest.Mock).mockImplementationOnce((_req, res) => {
        res.status(401).json({ error: 'Unauthorized' });
      });

      const response = await request(app).get('/soundboard/track/test-id/stream');

      expect(response.status).toBe(401);
    });
  });

  describe('GET /soundboard/preload/:sessionId', () => {
    it('should return 501 not implemented', async () => {
      const sessionId = '770e8400-e29b-41d4-a716-446655440000';

      const response = await request(app).get(`/soundboard/preload/${sessionId}`);

      expect(response.status).toBe(501);
      expect(response.body).toEqual({
        message: 'Preload session tracks not implemented yet',
        endpoint: 'GET /soundboard/preload/:sessionId',
        sessionId,
        note: 'Returns track URLs for client-side caching',
      });
    });

    it('should require authentication', async () => {
      (authenticate as jest.Mock).mockImplementationOnce((_req, res) => {
        res.status(401).json({ error: 'Unauthorized' });
      });

      const response = await request(app).get('/soundboard/preload/test-id');

      expect(response.status).toBe(401);
    });
  });

  describe('Authentication middleware', () => {
    it('should call authenticate middleware for all routes', async () => {
      await request(app).get('/soundboard/session/test-id');
      expect(authenticate).toHaveBeenCalled();

      jest.clearAllMocks();

      await request(app).post('/soundboard/session/test-id/active-scene');
      expect(authenticate).toHaveBeenCalled();

      jest.clearAllMocks();

      await request(app).get('/soundboard/track/test-id/stream');
      expect(authenticate).toHaveBeenCalled();

      jest.clearAllMocks();

      await request(app).get('/soundboard/preload/test-id');
      expect(authenticate).toHaveBeenCalled();
    });
  });
});
