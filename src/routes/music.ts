/**
 * Music routes
 * Handles track recipe management and track generation
 */

import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { authenticate } from '../middleware/auth';
import { getDatabase } from '../config/database';
import * as trackRecipeService from '../services/trackRecipeService';
import * as trackService from '../services/trackService';

const router = Router();

// All music routes require authentication
router.use(authenticate);

/**
 * POST /campaigns/:campaignId/recipes/design
 * Design a track recipe using LLM for a campaign
 */
router.post(
  '/campaigns/:campaignId/recipes/design',
  asyncHandler(async (req: Request, res: Response) => {
    const db = getDatabase();
    const userId = req.user!.id;
    const { campaignId } = req.params;
    const { existing_tags } = req.body;

    const recipe = await trackRecipeService.designRecipe(
      db,
      userId,
      campaignId,
      undefined,
      {
        existing_tags,
      }
    );

    res.status(201).json(recipe);
  })
);

/**
 * POST /campaigns/:campaignId/recipes
 * Create a track recipe manually for a campaign
 */
router.post(
  '/campaigns/:campaignId/recipes',
  asyncHandler(async (req: Request, res: Response) => {
    const db = getDatabase();
    const userId = req.user!.id;
    const { campaignId } = req.params;
    const {
      recipe_name,
      prompt,
      bpm,
      mood_tags,
      style_tags,
      instrument_tags,
    } = req.body;

    const recipe = await trackRecipeService.createRecipe(db, userId, {
      recipe_name,
      prompt,
      bpm,
      mood_tags,
      style_tags,
      instrument_tags,
      campaign_id: campaignId,
    });

    res.status(201).json(recipe);
  })
);

/**
 * GET /campaigns/:campaignId/recipes
 * List recipes for a campaign
 */
router.get(
  '/campaigns/:campaignId/recipes',
  asyncHandler(async (req: Request, res: Response) => {
    const db = getDatabase();
    const userId = req.user!.id;
    const { campaignId } = req.params;

    const recipes = await trackRecipeService.listRecipesForCampaign(
      db,
      userId,
      campaignId
    );

    res.status(200).json(recipes);
  })
);

/**
 * POST /sessions/:sessionId/recipes/design
 * Design a track recipe using LLM for a session
 */
router.post(
  '/sessions/:sessionId/recipes/design',
  asyncHandler(async (req: Request, res: Response) => {
    const db = getDatabase();
    const userId = req.user!.id;
    const { sessionId } = req.params;
    const { existing_tags } = req.body;

    const recipe = await trackRecipeService.designRecipe(
      db,
      userId,
      undefined,
      sessionId,
      {
        existing_tags,
      }
    );

    res.status(201).json(recipe);
  })
);

/**
 * POST /sessions/:sessionId/recipes
 * Create a track recipe manually for a session
 */
router.post(
  '/sessions/:sessionId/recipes',
  asyncHandler(async (req: Request, res: Response) => {
    const db = getDatabase();
    const userId = req.user!.id;
    const { sessionId } = req.params;
    const {
      recipe_name,
      prompt,
      bpm,
      mood_tags,
      style_tags,
      instrument_tags,
    } = req.body;

    const recipe = await trackRecipeService.createRecipe(db, userId, {
      recipe_name,
      prompt,
      bpm,
      mood_tags,
      style_tags,
      instrument_tags,
      session_id: sessionId,
    });

    res.status(201).json(recipe);
  })
);

/**
 * GET /sessions/:sessionId/recipes
 * List recipes for a session
 */
router.get(
  '/sessions/:sessionId/recipes',
  asyncHandler(async (req: Request, res: Response) => {
    const db = getDatabase();
    const userId = req.user!.id;
    const { sessionId } = req.params;

    const recipes = await trackRecipeService.listRecipesForSession(
      db,
      userId,
      sessionId
    );

    res.status(200).json(recipes);
  })
);

/**
 * GET /recipes/:id
 * Get a specific recipe
 */
router.get(
  '/recipes/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const db = getDatabase();
    const userId = req.user!.id;
    const { id } = req.params;

    const recipe = await trackRecipeService.getRecipe(db, userId, id);

    res.status(200).json(recipe);
  })
);

/**
 * DELETE /recipes/:id
 * Delete a recipe
 */
router.delete(
  '/recipes/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const db = getDatabase();
    const userId = req.user!.id;
    const { id } = req.params;

    await trackRecipeService.deleteRecipe(db, userId, id);

    res.status(204).send();
  })
);

/**
 * POST /recipes/:id/generate
 * Generate a track from recipe (async via background job)
 */
router.post(
  '/recipes/:id/generate',
  asyncHandler(async (req: Request, res: Response) => {
    const db = getDatabase();
    const userId = req.user!.id;
    const { id: recipeId } = req.params;
    const { test_mode } = req.body;

    const result = await trackService.generateTrack(db, userId, recipeId, {
      testMode: test_mode || false,
    });

    res.status(202).json(result);
  })
);

/**
 * GET /recipes/:id/tracks
 * List tracks for a recipe
 */
router.get(
  '/recipes/:id/tracks',
  asyncHandler(async (req: Request, res: Response) => {
    const db = getDatabase();
    const userId = req.user!.id;
    const { id: recipeId } = req.params;
    const quality_rating = req.query.quality_rating
      ? parseInt(req.query.quality_rating as string, 10)
      : undefined;

    const tracks = await trackService.listTracksForRecipe(db, userId, recipeId, {
      quality_rating: quality_rating as -1 | 0 | 1 | undefined,
    });

    res.status(200).json(tracks);
  })
);

/**
 * GET /tracks/:id
 * Get track status and details
 */
router.get(
  '/tracks/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const db = getDatabase();
    const userId = req.user!.id;
    const { id } = req.params;

    const track = await trackService.getTrackStatus(db, userId, id);

    res.status(200).json(track);
  })
);

/**
 * PUT /tracks/:id/rating
 * Rate a track's quality
 */
router.put(
  '/tracks/:id/rating',
  asyncHandler(async (req: Request, res: Response) => {
    const db = getDatabase();
    const userId = req.user!.id;
    const { id } = req.params;
    const { quality_rating, notes } = req.body;

    const track = await trackService.rateTrack(db, userId, id, {
      quality_rating,
      notes,
    });

    res.status(200).json(track);
  })
);

/**
 * DELETE /tracks/:id
 * Delete a track
 */
router.delete(
  '/tracks/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const db = getDatabase();
    const userId = req.user!.id;
    const { id } = req.params;

    await trackService.deleteTrack(db, userId, id);

    res.status(204).send();
  })
);

export default router;
