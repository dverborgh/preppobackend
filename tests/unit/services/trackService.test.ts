/**
 * Unit tests for trackService
 */

import * as trackService from '../../../src/services/trackService';
import { getRecipe } from '../../../src/services/trackRecipeService';
import { getJobQueue } from '../../../src/config/jobQueue';
import { ValidationError, NotFoundError } from '../../../src/types';

// Mock dependencies
jest.mock('../../../src/services/trackRecipeService');
jest.mock('../../../src/config/jobQueue');
jest.mock('../../../src/utils/logger');

describe('trackService', () => {
  let mockDb: any;
  let mockQueue: any;
  const userId = 'user-123';
  const recipeId = 'recipe-123';
  const trackId = 'track-123';

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Mock database
    mockDb = {
      one: jest.fn(),
      oneOrNone: jest.fn(),
      any: jest.fn(),
      result: jest.fn(),
    };

    // Mock job queue
    mockQueue = {
      send: jest.fn().mockResolvedValue(undefined),
    };
    (getJobQueue as jest.Mock).mockReturnValue(mockQueue);

    // Mock recipe verification (always passes)
    (getRecipe as jest.Mock).mockResolvedValue({
      id: recipeId,
      scene_id: 'scene-123',
      recipe_name: 'Test Recipe',
      prompt: 'Test prompt',
      bpm: 120,
      created_at: new Date(),
    });
  });

  describe('generateTrack', () => {
    it('should generate a track successfully', async () => {
      const expectedTrack = {
        id: trackId,
        recipe_id: recipeId,
        suno_track_id: null,
        file_url: null,
        duration_seconds: null,
        quality_rating: 0,
        notes: null,
        created_at: new Date(),
      };

      mockDb.one.mockResolvedValue(expectedTrack);

      const result = await trackService.generateTrack(mockDb, userId, recipeId);

      expect(getRecipe).toHaveBeenCalledWith(mockDb, userId, recipeId);
      expect(mockDb.one).toHaveBeenCalled();
      expect(result).toHaveProperty('trackId', trackId);
      expect(result).toHaveProperty('status', 'pending');
      expect(mockQueue.send).toHaveBeenCalledWith('generate-track', {
        trackId,
        recipeId,
        testMode: false,
      });
    });

    it('should enqueue track generation job with testMode', async () => {
      const expectedTrack = {
        id: trackId,
        recipe_id: recipeId,
        quality_rating: 0,
        created_at: new Date(),
      };

      mockDb.one.mockResolvedValue(expectedTrack);

      await trackService.generateTrack(mockDb, userId, recipeId, {
        testMode: true,
      });

      expect(mockQueue.send).toHaveBeenCalledWith('generate-track', {
        trackId,
        recipeId,
        testMode: true,
      });
    });

    it('should continue even if job queue fails', async () => {
      const expectedTrack = {
        id: trackId,
        recipe_id: recipeId,
        quality_rating: 0,
        created_at: new Date(),
      };

      mockDb.one.mockResolvedValue(expectedTrack);
      mockQueue.send.mockImplementation(() => {
        throw new Error('Queue error');
      });

      // Should not throw even if queue fails
      const result = await trackService.generateTrack(mockDb, userId, recipeId);

      expect(result).toHaveProperty('trackId', trackId);
    });
  });

  describe('getTrackStatus', () => {
    it('should return track with completed status when file_url exists', async () => {
      const completedTrack = {
        id: trackId,
        recipe_id: recipeId,
        suno_track_id: 'suno-123',
        file_url: 'https://example.com/track.mp3',
        duration_seconds: 180,
        quality_rating: 0,
        created_at: new Date(),
      };

      mockDb.oneOrNone.mockResolvedValue(completedTrack);

      const result = await trackService.getTrackStatus(mockDb, userId, trackId);

      expect(result.status).toBe('completed');
      expect(result.file_url).toBe('https://example.com/track.mp3');
    });

    it('should return track with generating status when suno_track_id exists but no file_url', async () => {
      const generatingTrack = {
        id: trackId,
        recipe_id: recipeId,
        suno_track_id: 'suno-123',
        file_url: null,
        quality_rating: 0,
        created_at: new Date(),
      };

      mockDb.oneOrNone.mockResolvedValue(generatingTrack);

      const result = await trackService.getTrackStatus(mockDb, userId, trackId);

      expect(result.status).toBe('generating');
    });

    it('should return track with pending status when neither suno_track_id nor file_url exists', async () => {
      const pendingTrack = {
        id: trackId,
        recipe_id: recipeId,
        suno_track_id: null,
        file_url: null,
        quality_rating: 0,
        created_at: new Date(),
      };

      mockDb.oneOrNone.mockResolvedValue(pendingTrack);

      const result = await trackService.getTrackStatus(mockDb, userId, trackId);

      expect(result.status).toBe('pending');
    });

    it('should throw NotFoundError if track does not exist', async () => {
      mockDb.oneOrNone.mockResolvedValue(null);

      await expect(
        trackService.getTrackStatus(mockDb, userId, trackId)
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('listTracksForRecipe', () => {
    it('should list all tracks for a recipe', async () => {
      const expectedTracks = [
        {
          id: 'track-1',
          recipe_id: recipeId,
          quality_rating: 1,
          created_at: new Date(),
        },
        {
          id: 'track-2',
          recipe_id: recipeId,
          quality_rating: 0,
          created_at: new Date(),
        },
      ];

      mockDb.any.mockResolvedValue(expectedTracks);

      const result = await trackService.listTracksForRecipe(
        mockDb,
        userId,
        recipeId
      );

      expect(getRecipe).toHaveBeenCalledWith(mockDb, userId, recipeId);
      expect(result).toEqual(expectedTracks);
    });

    it('should filter tracks by quality rating', async () => {
      const goodTracks = [
        {
          id: 'track-1',
          recipe_id: recipeId,
          quality_rating: 1,
          created_at: new Date(),
        },
      ];

      mockDb.any.mockResolvedValue(goodTracks);

      const result = await trackService.listTracksForRecipe(
        mockDb,
        userId,
        recipeId,
        { quality_rating: 1 }
      );

      expect(result).toEqual(goodTracks);
      // Check that the query included the quality rating filter
      const callArgs = mockDb.any.mock.calls[0];
      expect(callArgs[0]).toContain('quality_rating');
    });

    it('should reject invalid quality rating', async () => {
      await expect(
        trackService.listTracksForRecipe(mockDb, userId, recipeId, {
          quality_rating: 5 as any,
        })
      ).rejects.toThrow(ValidationError);
    });

    it('should return empty array if no tracks exist', async () => {
      mockDb.any.mockResolvedValue([]);

      const result = await trackService.listTracksForRecipe(
        mockDb,
        userId,
        recipeId
      );

      expect(result).toEqual([]);
    });
  });

  describe('rateTrack', () => {
    const existingTrack = {
      id: trackId,
      recipe_id: recipeId,
      file_url: 'https://example.com/track.mp3',
      quality_rating: 0,
      notes: null,
      created_at: new Date(),
    };

    beforeEach(() => {
      mockDb.oneOrNone.mockResolvedValue(existingTrack);
    });

    it('should rate track as good (1)', async () => {
      const ratedTrack = { ...existingTrack, quality_rating: 1 };
      mockDb.one.mockResolvedValue(ratedTrack);

      const result = await trackService.rateTrack(mockDb, userId, trackId, {
        quality_rating: 1,
      });

      expect(result.quality_rating).toBe(1);
      expect(mockDb.one).toHaveBeenCalled();
    });

    it('should rate track as bad (-1)', async () => {
      const ratedTrack = { ...existingTrack, quality_rating: -1 };
      mockDb.one.mockResolvedValue(ratedTrack);

      const result = await trackService.rateTrack(mockDb, userId, trackId, {
        quality_rating: -1,
      });

      expect(result.quality_rating).toBe(-1);
    });

    it('should rate track as unreviewed (0)', async () => {
      const ratedTrack = { ...existingTrack, quality_rating: 0 };
      mockDb.one.mockResolvedValue(ratedTrack);

      const result = await trackService.rateTrack(mockDb, userId, trackId, {
        quality_rating: 0,
      });

      expect(result.quality_rating).toBe(0);
    });

    it('should update track with notes', async () => {
      const notes = 'Great battle music, perfect tempo';
      const ratedTrack = { ...existingTrack, quality_rating: 1, notes };
      mockDb.one.mockResolvedValue(ratedTrack);

      const result = await trackService.rateTrack(mockDb, userId, trackId, {
        quality_rating: 1,
        notes,
      });

      expect(result.notes).toBe(notes);
    });

    it('should reject invalid quality rating', async () => {
      await expect(
        trackService.rateTrack(mockDb, userId, trackId, {
          quality_rating: 5 as any,
        })
      ).rejects.toThrow(ValidationError);
    });

    it('should reject notes exceeding 1000 characters', async () => {
      const longNotes = 'a'.repeat(1001);

      await expect(
        trackService.rateTrack(mockDb, userId, trackId, {
          quality_rating: 1,
          notes: longNotes,
        })
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('deleteTrack', () => {
    it('should delete a track successfully', async () => {
      const existingTrack = {
        id: trackId,
        recipe_id: recipeId,
        quality_rating: 0,
        created_at: new Date(),
      };

      mockDb.oneOrNone.mockResolvedValue(existingTrack);
      mockDb.result.mockResolvedValue({ rowCount: 1 });

      await trackService.deleteTrack(mockDb, userId, trackId);

      expect(mockDb.result).toHaveBeenCalledWith(
        'DELETE FROM tracks WHERE id = $1',
        [trackId]
      );
    });

    it('should throw NotFoundError if track does not exist', async () => {
      mockDb.oneOrNone.mockResolvedValue(null);

      await expect(
        trackService.deleteTrack(mockDb, userId, trackId)
      ).rejects.toThrow(NotFoundError);
    });

    it('should throw NotFoundError if delete fails', async () => {
      const existingTrack = {
        id: trackId,
        recipe_id: recipeId,
        quality_rating: 0,
        created_at: new Date(),
      };

      mockDb.oneOrNone.mockResolvedValue(existingTrack);
      mockDb.result.mockResolvedValue({ rowCount: 0 });

      await expect(
        trackService.deleteTrack(mockDb, userId, trackId)
      ).rejects.toThrow(NotFoundError);
    });
  });
});
