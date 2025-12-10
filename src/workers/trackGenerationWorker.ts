/**
 * Track Generation Worker
 * Background job handler for generating music tracks via Suno API
 * Polls API until track generation completes
 */

import { getJobQueue } from '../config/jobQueue';
import { getDatabase } from '../config/database';
import * as sunoApiClient from '../services/sunoApiClient';
import logger from '../utils/logger';

/**
 * Job payload for track generation
 */
export interface GenerateTrackJob {
  trackId: string;
  recipeId: string;
  testMode?: boolean;
}

/**
 * Process a single track generation job
 * Polls Suno API until track is complete or fails
 */
async function processTrackGenerationJob(job: any): Promise<void> {
  const { trackId, recipeId, testMode } = job.data as GenerateTrackJob;
  const db = getDatabase();

  const startTime = Date.now();

  try {
    logger.info('Starting track generation', {
      track_id: trackId,
      recipe_id: recipeId,
      test_mode: testMode || false,
    });

    // Get recipe details
    const recipe = await db.oneOrNone(
      'SELECT * FROM track_recipes WHERE id = $1',
      [recipeId]
    );

    if (!recipe) {
      throw new Error(`Recipe not found: ${recipeId}`);
    }

    // Build generation options from recipe
    const generationOptions: sunoApiClient.GenerateTrackOptions = {
      bpm: recipe.bpm || undefined,
      tags: [
        ...(recipe.mood_tags || []),
        ...(recipe.style_tags || []),
        ...(recipe.instrument_tags || []),
      ],
      testMode: testMode || false,
    };

    // Step 1: Initiate track generation via Suno API
    logger.debug('Calling Suno API to generate track', {
      track_id: trackId,
      prompt_length: recipe.prompt.length,
      bpm: generationOptions.bpm,
      tag_count: generationOptions.tags?.length || 0,
    });

    const { sunoTrackId, status: initialStatus } = await sunoApiClient.generateTrack(
      recipe.prompt,
      generationOptions
    );

    // Step 2: Update track with suno_track_id
    await db.none(
      'UPDATE tracks SET suno_track_id = $1 WHERE id = $2',
      [sunoTrackId, trackId]
    );

    logger.info('Suno track ID stored', {
      track_id: trackId,
      suno_track_id: sunoTrackId,
      initial_status: initialStatus,
    });

    // Step 3: Poll for completion if not already complete
    if (initialStatus !== 'completed') {
      let attempts = 0;
      const maxAttempts = 24; // 24 * 5s = 2 minutes max
      const pollInterval = 5000; // 5 seconds

      while (attempts < maxAttempts) {
        // Wait before polling
        await sunoApiClient.sleep(pollInterval);
        attempts++;

        logger.debug('Polling track status', {
          track_id: trackId,
          suno_track_id: sunoTrackId,
          attempt: attempts,
          max_attempts: maxAttempts,
        });

        const trackStatus = await sunoApiClient.getTrackStatus(sunoTrackId, testMode);

        if (trackStatus.status === 'completed') {
          // Track generation successful
          if (!trackStatus.audioUrl) {
            throw new Error('Track completed but no audio URL provided');
          }

          await db.none(
            `UPDATE tracks
             SET file_url = $1, duration_seconds = $2
             WHERE id = $3`,
            [trackStatus.audioUrl, trackStatus.duration || null, trackId]
          );

          const latency = Date.now() - startTime;

          logger.info('Track generation completed', {
            track_id: trackId,
            suno_track_id: sunoTrackId,
            duration_seconds: trackStatus.duration,
            attempts,
            latency_ms: latency,
          });

          return; // Success!
        }

        if (trackStatus.status === 'failed') {
          throw new Error(
            `Track generation failed: ${trackStatus.error || 'Unknown error'}`
          );
        }

        // Status is still 'generating', continue polling
        logger.debug('Track still generating', {
          track_id: trackId,
          suno_track_id: sunoTrackId,
          attempt: attempts,
        });
      }

      // Timeout reached
      throw new Error(
        `Track generation timeout after ${maxAttempts * pollInterval / 1000} seconds`
      );
    } else {
      // Track completed immediately (test mode)
      const trackStatus = await sunoApiClient.getTrackStatus(sunoTrackId, testMode);

      if (trackStatus.audioUrl) {
        await db.none(
          `UPDATE tracks
           SET file_url = $1, duration_seconds = $2
           WHERE id = $3`,
          [trackStatus.audioUrl, trackStatus.duration || null, trackId]
        );
      }

      const latency = Date.now() - startTime;

      logger.info('Track generation completed immediately', {
        track_id: trackId,
        suno_track_id: sunoTrackId,
        latency_ms: latency,
      });
    }
  } catch (error: any) {
    const latency = Date.now() - startTime;

    logger.error('Track generation job failed', {
      track_id: trackId,
      recipe_id: recipeId,
      error: error.message,
      stack: error.stack,
      latency_ms: latency,
    });

    // Note: We don't update the track status to 'failed' in the database
    // because we're using computed status based on data availability
    // The track will show as 'generating' until manually deleted

    throw error; // Re-throw to mark job as failed in pg-boss
  }
}

/**
 * Register track generation worker with job queue
 * Sets up job handler with retry policy
 */
export async function registerTrackGenerationWorker(): Promise<void> {
  const queue = getJobQueue();

  // Configure worker with retry policy
  const workerOptions = {
    teamSize: 2, // Process up to 2 tracks concurrently
    teamConcurrency: 1, // Each worker handles 1 job at a time
    retryLimit: 2, // Retry failed jobs up to 2 times
    retryDelay: 60, // Wait 60 seconds between retries
    expireInSeconds: 600, // Job expires after 10 minutes if not started
  };

  await queue.work('generate-track', workerOptions, processTrackGenerationJob);

  logger.info('Track generation worker registered', {
    job_type: 'generate-track',
    team_size: workerOptions.teamSize,
    retry_limit: workerOptions.retryLimit,
  });
}

/**
 * Get track generation queue statistics
 */
export async function getTrackGenerationStats(): Promise<any> {
  const queue = getJobQueue();

  try {
    const queueSize = await queue.getQueueSize('generate-track');

    return {
      job_type: 'generate-track',
      queue_size: queueSize,
      timestamp: new Date().toISOString(),
    };
  } catch (error: any) {
    logger.error('Error getting track generation stats', { error: error.message });
    return null;
  }
}
