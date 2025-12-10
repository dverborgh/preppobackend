/**
 * RAG (Retrieval-Augmented Generation) routes
 * Handles knowledge base queries using vector search and LLM
 */

import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { authenticate, requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { body, param } from 'express-validator';
import { getDatabase } from '../config/database';
import * as ragService from '../services/ragService';
import { ForbiddenError } from '../types';
import logger from '../utils/logger';

const router = Router();

// All RAG routes require authentication
router.use(authenticate);

/**
 * POST /api/campaigns/:campaignId/rag/query
 * Ask a question about campaign resources using RAG
 * Returns answer with citations in < 2 seconds
 */
router.post(
  '/campaigns/:campaignId/rag/query',
  [
    param('campaignId').isUUID().withMessage('Invalid campaign ID'),
    body('query')
      .isString()
      .isLength({ min: 10, max: 500 })
      .trim()
      .withMessage('Query must be between 10 and 500 characters'),
    body('resource_ids')
      .optional()
      .isArray()
      .withMessage('resource_ids must be an array'),
    body('resource_ids.*')
      .optional()
      .isUUID()
      .withMessage('Each resource_id must be a valid UUID'),
    body('conversation_id')
      .optional()
      .isUUID()
      .withMessage('conversation_id must be a valid UUID'),
    body('top_k')
      .optional()
      .isInt({ min: 1, max: 20 })
      .withMessage('top_k must be an integer between 1 and 20'),
    body('stream')
      .optional()
      .isBoolean()
      .withMessage('stream must be a boolean'),
  ],
  validate,
  asyncHandler(async (req: Request, res: Response) => {
    const user = requireAuth(req);
    const db = getDatabase();
    const { campaignId } = req.params;
    const { query, resource_ids, conversation_id, top_k, stream } = req.body;

    logger.info('RAG query request', {
      userId: user.id,
      campaignId,
      queryLength: query.length,
      resourceIdsCount: resource_ids?.length || 0,
      conversationId: conversation_id,
      topK: top_k,
      streaming: !!stream,
    });

    // If streaming is requested, use SSE
    if (stream) {
      // Set headers for Server-Sent Events
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

      // Flush headers immediately to establish SSE connection
      res.flushHeaders();

      // Perform hybrid search to get relevant chunks
      const startTime = Date.now();
      const chunks = await ragService.hybridSearch(
        db,
        campaignId,
        query,
        top_k || 10,
        resource_ids ? { resourceIds: resource_ids } : undefined
      );
      const searchLatencyMs = Date.now() - startTime;

      // Stream the answer
      try {
        const streamGenerator = ragService.generateAnswerStream(query, chunks);
        let fullAnswer = '';
        let queryMetadata: any = null;

        for await (const event of streamGenerator) {
          // Send SSE event and flush immediately
          res.write(`data: ${JSON.stringify(event)}\n\n`);

          // Force flush to send data immediately (Node.js doesn't auto-flush SSE)
          if (typeof (res as any).flush === 'function') {
            (res as any).flush();
          }

          // Debug logging
          if (event.type === 'chunk') {
            logger.debug('Sent chunk event', { contentLength: event.content.length });
          } else {
            logger.debug('Sent SSE event', { type: event.type });
          }

          // Collect full answer for logging
          if (event.type === 'chunk') {
            fullAnswer += event.content;
          } else if (event.type === 'done') {
            queryMetadata = event.metadata;
            queryMetadata.searchLatencyMs = searchLatencyMs;
          }
        }

        // Log query to database
        if (queryMetadata && fullAnswer) {
          const queryId = await ragService.logQuery(db, {
            campaignId,
            userId: user.id,
            query,
            retrievedChunkIds: chunks.map((c) => c.chunkId),
            retrievedChunkScores: chunks.map((c) => c.score),
            answer: fullAnswer,
            model: queryMetadata.model,
            promptTokens: queryMetadata.promptTokens,
            completionTokens: queryMetadata.completionTokens,
            latencyMs: queryMetadata.latencyMs,
            conversationId: conversation_id,
          });

          // Send final event with query ID
          res.write(
            `data: ${JSON.stringify({ type: 'queryId', queryId })}\n\n`
          );
        }

        res.end();
      } catch (error: any) {
        logger.error('Streaming query failed', {
          error: error.message,
          userId: user.id,
          campaignId,
        });

        // Send error event
        res.write(
          `data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`
        );
        res.end();
      }
    } else {
      // Non-streaming response (existing behavior)
      const result = await ragService.query(db, user.id, campaignId, query, {
        resourceIds: resource_ids,
        conversationId: conversation_id,
        topK: top_k,
      });

      res.status(200).json(result);
    }
  })
);

/**
 * POST /api/rag/queries/:queryId/feedback
 * Provide feedback on RAG query quality
 */
router.post(
  '/rag/queries/:queryId/feedback',
  [
    param('queryId').isUUID().withMessage('Invalid query ID'),
    body('rating')
      .isInt({ min: 1, max: 5 })
      .withMessage('Rating must be an integer between 1 and 5'),
    body('comment')
      .optional()
      .isString()
      .isLength({ max: 500 })
      .withMessage('Comment must be at most 500 characters'),
  ],
  validate,
  asyncHandler(async (req: Request, res: Response) => {
    const user = requireAuth(req);
    const db = getDatabase();
    const { queryId } = req.params;
    const { rating, comment } = req.body;

    logger.info('RAG query feedback', {
      userId: user.id,
      queryId,
      rating,
      hasComment: !!comment,
    });

    // Verify user owns the query
    const query = await db.oneOrNone(
      'SELECT user_id FROM rag_queries WHERE id = $1',
      [queryId]
    );

    if (!query) {
      res.status(404).json({
        error: 'Query not found',
        code: 'NOT_FOUND',
      });
      return;
    }

    if (query.user_id !== user.id) {
      throw new ForbiddenError('You can only provide feedback on your own queries');
    }

    // Update feedback
    await db.none(
      `UPDATE rag_queries
       SET feedback_rating = $1,
           feedback_comment = $2,
           feedback_updated_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [rating, comment || null, queryId]
    );

    logger.info('RAG query feedback saved', {
      queryId,
      rating,
    });

    res.status(204).send();
  })
);

/**
 * POST /rag/search
 * Search for relevant chunks without LLM generation
 */
router.post(
  '/search',
  asyncHandler(async (_req: Request, res: Response) => {
    res.status(501).json({
      message: 'RAG search not implemented yet',
      endpoint: 'POST /rag/search',
      note: 'Returns relevant resource chunks based on vector similarity',
    });
  })
);

/**
 * POST /rag/evaluate
 * Evaluate RAG quality using golden questions
 */
router.post(
  '/evaluate',
  asyncHandler(async (_req: Request, res: Response) => {
    res.status(501).json({
      message: 'RAG evaluation not implemented yet',
      endpoint: 'POST /rag/evaluate',
      note: 'Tests retrieval quality against golden question set',
    });
  })
);

/**
 * GET /rag/golden-questions
 * Get golden questions for a campaign
 */
router.get(
  '/golden-questions',
  asyncHandler(async (req: Request, res: Response) => {
    res.status(501).json({
      message: 'Get golden questions not implemented yet',
      endpoint: 'GET /rag/golden-questions',
      query: req.query,
    });
  })
);

/**
 * POST /rag/golden-questions
 * Add a golden question for RAG evaluation
 */
router.post(
  '/golden-questions',
  asyncHandler(async (_req: Request, res: Response) => {
    res.status(501).json({
      message: 'Create golden question not implemented yet',
      endpoint: 'POST /rag/golden-questions',
    });
  })
);

export default router;
