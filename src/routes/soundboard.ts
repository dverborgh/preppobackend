/**
 * Soundboard routes
 * Handles soundboard operations during gameplay
 */

import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { authenticate } from '../middleware/auth';

const router = Router();

// All soundboard routes require authentication
router.use(authenticate);

/**
 * GET /soundboard/session/:sessionId
 * Get soundboard data for a session (scenes + tracks)
 */
router.get(
  '/session/:sessionId',
  asyncHandler(async (req: Request, res: Response) => {
    res.status(501).json({
      message: 'Get session soundboard not implemented yet',
      endpoint: 'GET /soundboard/session/:sessionId',
      sessionId: req.params.sessionId,
      note: 'Returns scenes with associated tracks for soundboard UI',
    });
  })
);

/**
 * POST /soundboard/session/:sessionId/active-scene
 * Set the active scene for a session
 */
router.post(
  '/session/:sessionId/active-scene',
  asyncHandler(async (req: Request, res: Response) => {
    res.status(501).json({
      message: 'Set active scene not implemented yet',
      endpoint: 'POST /soundboard/session/:sessionId/active-scene',
      sessionId: req.params.sessionId,
    });
  })
);

/**
 * GET /soundboard/track/:trackId/stream
 * Stream audio file for a track
 */
router.get(
  '/track/:trackId/stream',
  asyncHandler(async (req: Request, res: Response) => {
    res.status(501).json({
      message: 'Stream track not implemented yet',
      endpoint: 'GET /soundboard/track/:trackId/stream',
      trackId: req.params.trackId,
      note: 'Will stream audio file from S3 storage',
    });
  })
);

/**
 * GET /soundboard/preload/:sessionId
 * Preload all track metadata for a session (for offline/cached playback)
 */
router.get(
  '/preload/:sessionId',
  asyncHandler(async (req: Request, res: Response) => {
    res.status(501).json({
      message: 'Preload session tracks not implemented yet',
      endpoint: 'GET /soundboard/preload/:sessionId',
      sessionId: req.params.sessionId,
      note: 'Returns track URLs for client-side caching',
    });
  })
);

export default router;
