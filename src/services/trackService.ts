/**
 * Track service
 * Handles track generation, status checking, and curation
 */

import { ExtendedDatabase } from '../config/database';
import { NotFoundError, ValidationError, Track } from '../types';
import logger from '../utils/logger';
import { getRecipe } from './trackRecipeService';
import { getJobQueue } from '../config/jobQueue';

// Track data types
export interface GenerateTrackOptions {
  testMode?: boolean;
}

export interface RateTrackData {
  quality_rating: -1 | 0 | 1;
  notes?: string;
}

export interface ListTracksOptions {
  quality_rating?: -1 | 0 | 1;
}

export interface TrackWithStatus extends Track {
  status: 'pending' | 'generating' | 'completed' | 'failed';
}

/**
 * Generate a track from recipe
 * Creates track record and enqueues background job for generation
 *
 * @returns Track ID and status (pending/generating)
 */
export async function generateTrack(
  db: ExtendedDatabase,
  userId: string,
  recipeId: string,
  options?: GenerateTrackOptions
): Promise<{ trackId: string; status: 'pending' | 'generating' }> {
  // Verify recipe ownership and get recipe details
  const recipe = await getRecipe(db, userId, recipeId);

  // Create track record with pending status
  // Inherit campaign_id and session_id from recipe
  const track = await db.one<Track>(
    `INSERT INTO tracks (recipe_id, campaign_id, session_id, quality_rating)
     VALUES ($1, $2, $3, 0)
     RETURNING *`,
    [recipeId, recipe.campaign_id || null, recipe.session_id || null]
  );

  logger.info('Track generation initiated', {
    track_id: track.id,
    recipe_id: recipeId,
    user_id: userId,
    test_mode: options?.testMode || false,
  });

  // Enqueue background job for track generation
  try {
    const queue = getJobQueue();
    await queue.send('generate-track', {
      trackId: track.id,
      recipeId: recipeId,
      testMode: options?.testMode || false,
    });

    logger.debug('Track generation job enqueued', {
      track_id: track.id,
      recipe_id: recipeId,
    });
  } catch (error: any) {
    logger.error('Failed to enqueue track generation job', {
      track_id: track.id,
      error: error.message,
    });
    // Don't throw - track was created, job system issue is separate
  }

  return {
    trackId: track.id,
    status: 'pending',
  };
}

/**
 * Get track generation status
 * Returns track with computed status based on data availability
 */
export async function getTrackStatus(
  db: ExtendedDatabase,
  userId: string,
  trackId: string
): Promise<TrackWithStatus> {
  // Get track
  const track = await db.oneOrNone<Track>(
    'SELECT * FROM tracks WHERE id = $1',
    [trackId]
  );

  if (!track) {
    throw new NotFoundError('Track');
  }

  // Verify ownership via recipe
  await getRecipe(db, userId, track.recipe_id);

  // Determine status based on track data
  let status: 'pending' | 'generating' | 'completed' | 'failed';

  if (track.file_url) {
    status = 'completed';
  } else if (track.suno_track_id) {
    // Has Suno ID but no file URL - still generating
    status = 'generating';
  } else {
    // No Suno ID yet - pending
    status = 'pending';
  }

  logger.debug('Track status retrieved', {
    track_id: trackId,
    status,
    user_id: userId,
  });

  return {
    ...track,
    status,
  };
}

/**
 * List tracks for a recipe
 * Optionally filter by quality rating
 */
export async function listTracksForRecipe(
  db: ExtendedDatabase,
  userId: string,
  recipeId: string,
  options?: ListTracksOptions
): Promise<Track[]> {
  // Verify recipe ownership
  await getRecipe(db, userId, recipeId);

  // Build query with optional quality filter
  let query = 'SELECT * FROM tracks WHERE recipe_id = $1';
  const params: any[] = [recipeId];

  if (options?.quality_rating !== undefined) {
    // Validate quality rating
    if (![-1, 0, 1].includes(options.quality_rating)) {
      throw new ValidationError('Quality rating must be -1, 0, or 1');
    }
    params.push(options.quality_rating);
    query += ` AND quality_rating = $${params.length}`;
  }

  query += ' ORDER BY created_at DESC';

  const tracks = await db.any<Track>(query, params);

  logger.debug('Tracks listed', {
    recipe_id: recipeId,
    user_id: userId,
    count: tracks.length,
    quality_filter: options?.quality_rating,
  });

  return tracks;
}

/**
 * Rate track quality
 * Updates quality rating and optional notes
 */
export async function rateTrack(
  db: ExtendedDatabase,
  userId: string,
  trackId: string,
  data: RateTrackData
): Promise<Track> {
  // Get track and verify ownership
  await getTrackStatus(db, userId, trackId);

  // Validate quality rating
  if (![-1, 0, 1].includes(data.quality_rating)) {
    throw new ValidationError('Quality rating must be -1 (bad), 0 (unreviewed), or 1 (good)');
  }

  // Validate notes if provided
  if (data.notes !== undefined && data.notes !== null) {
    if (data.notes.trim().length > 1000) {
      throw new ValidationError('Notes must not exceed 1000 characters');
    }
  }

  // Update track
  const updated = await db.one<Track>(
    `UPDATE tracks
     SET quality_rating = $1, notes = $2
     WHERE id = $3
     RETURNING *`,
    [
      data.quality_rating,
      data.notes?.trim() || null,
      trackId,
    ]
  );

  logger.info('Track rated', {
    track_id: trackId,
    user_id: userId,
    quality_rating: data.quality_rating,
    has_notes: !!data.notes,
  });

  return updated;
}

/**
 * Delete track
 * Verifies ownership before deletion
 */
export async function deleteTrack(
  db: ExtendedDatabase,
  userId: string,
  trackId: string
): Promise<void> {
  // Get track and verify ownership
  await getTrackStatus(db, userId, trackId);

  const result = await db.result(
    'DELETE FROM tracks WHERE id = $1',
    [trackId]
  );

  if (result.rowCount === 0) {
    throw new NotFoundError('Track');
  }

  logger.info('Track deleted', {
    track_id: trackId,
    user_id: userId,
  });
}
