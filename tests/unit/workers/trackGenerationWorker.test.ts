/**
 * Unit tests for track generation worker
 */

import * as trackGenerationWorker from '../../../src/workers/trackGenerationWorker';
import * as sunoApiClient from '../../../src/services/sunoApiClient';

// Mock dependencies
jest.mock('../../../src/config/jobQueue');
jest.mock('../../../src/config/database');
jest.mock('../../../src/services/sunoApiClient');
jest.mock('../../../src/utils/logger');

const mockDb = {
  oneOrNone: jest.fn(),
  none: jest.fn(),
};

const mockQueue = {
  work: jest.fn(),
  getQueueSize: jest.fn(),
};

// Import mocked modules
const { getJobQueue } = require('../../../src/config/jobQueue');
const { getDatabase } = require('../../../src/config/database');

describe('Track Generation Worker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getDatabase.mockReturnValue(mockDb);
    getJobQueue.mockReturnValue(mockQueue);
  });

  describe('registerTrackGenerationWorker', () => {
    it('should register worker with correct options', async () => {
      await trackGenerationWorker.registerTrackGenerationWorker();

      expect(mockQueue.work).toHaveBeenCalledWith(
        'generate-track',
        expect.objectContaining({
          teamSize: 2,
          teamConcurrency: 1,
          retryLimit: 2,
          retryDelay: 60,
          expireInSeconds: 600,
        }),
        expect.any(Function)
      );
    });
  });

  describe('getTrackGenerationStats', () => {
    it('should return queue statistics', async () => {
      mockQueue.getQueueSize.mockResolvedValue(5);

      const stats = await trackGenerationWorker.getTrackGenerationStats();

      expect(stats).toMatchObject({
        job_type: 'generate-track',
        queue_size: 5,
      });
      expect(stats.timestamp).toBeDefined();
    });

    it('should return null on error', async () => {
      mockQueue.getQueueSize.mockRejectedValue(new Error('Queue error'));

      const stats = await trackGenerationWorker.getTrackGenerationStats();

      expect(stats).toBeNull();
    });
  });

  describe('processTrackGenerationJob', () => {
    let processJob: any;

    beforeEach(async () => {
      await trackGenerationWorker.registerTrackGenerationWorker();
      processJob = mockQueue.work.mock.calls[0][2];
    });

    it('should process track generation successfully (immediate completion)', async () => {
      const mockRecipe = {
        id: 'recipe-1',
        prompt: 'Epic battle music',
        bpm: 120,
        mood_tags: ['epic', 'intense'],
        style_tags: ['orchestral'],
        instrument_tags: ['strings', 'brass'],
      };

      mockDb.oneOrNone.mockResolvedValue(mockRecipe);
      mockDb.none.mockResolvedValue(null);

      (sunoApiClient.generateTrack as jest.Mock).mockResolvedValue({
        sunoTrackId: 'suno-123',
        status: 'completed',
      });

      (sunoApiClient.getTrackStatus as jest.Mock).mockResolvedValue({
        status: 'completed',
        audioUrl: 'https://example.com/track.mp3',
        duration: 180,
      });

      const job = {
        data: {
          trackId: 'track-1',
          recipeId: 'recipe-1',
          testMode: true,
        },
      };

      await processJob(job);

      // Verify Suno API was called with correct options
      expect(sunoApiClient.generateTrack).toHaveBeenCalledWith(
        'Epic battle music',
        expect.objectContaining({
          bpm: 120,
          tags: ['epic', 'intense', 'orchestral', 'strings', 'brass'],
          testMode: true,
        })
      );

      // Verify track was updated with suno_track_id
      expect(mockDb.none).toHaveBeenCalledWith(
        'UPDATE tracks SET suno_track_id = $1 WHERE id = $2',
        ['suno-123', 'track-1']
      );

      // Verify track was updated with audio URL and duration
      expect(mockDb.none).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE tracks'),
        expect.arrayContaining(['https://example.com/track.mp3', 180, 'track-1'])
      );
    });

    it('should poll until track generation completes', async () => {
      const mockRecipe = {
        id: 'recipe-1',
        prompt: 'Tavern ambience',
        bpm: null,
        mood_tags: ['relaxed'],
        style_tags: [],
        instrument_tags: [],
      };

      mockDb.oneOrNone.mockResolvedValue(mockRecipe);
      mockDb.none.mockResolvedValue(null);

      // Mock initial generation returning 'generating' status
      (sunoApiClient.generateTrack as jest.Mock).mockResolvedValue({
        sunoTrackId: 'suno-456',
        status: 'generating',
      });

      // Mock polling: first 2 calls return 'generating', 3rd returns 'completed'
      (sunoApiClient.getTrackStatus as jest.Mock)
        .mockResolvedValueOnce({
          status: 'generating',
        })
        .mockResolvedValueOnce({
          status: 'generating',
        })
        .mockResolvedValueOnce({
          status: 'completed',
          audioUrl: 'https://example.com/tavern.mp3',
          duration: 240,
        });

      // Mock sleep to make test faster
      (sunoApiClient.sleep as jest.Mock).mockResolvedValue(undefined);

      const job = {
        data: {
          trackId: 'track-2',
          recipeId: 'recipe-1',
          testMode: false,
        },
      };

      await processJob(job);

      // Verify polling happened
      expect(sunoApiClient.getTrackStatus).toHaveBeenCalledTimes(3);
      expect(sunoApiClient.sleep).toHaveBeenCalledWith(5000);

      // Verify final update
      expect(mockDb.none).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE tracks'),
        expect.arrayContaining(['https://example.com/tavern.mp3', 240, 'track-2'])
      );
    });

    it('should throw error if recipe not found', async () => {
      mockDb.oneOrNone.mockResolvedValue(null);

      const job = {
        data: {
          trackId: 'track-3',
          recipeId: 'nonexistent',
          testMode: false,
        },
      };

      await expect(processJob(job)).rejects.toThrow('Recipe not found: nonexistent');
    });

    it('should throw error if track generation fails', async () => {
      const mockRecipe = {
        id: 'recipe-1',
        prompt: 'Test music',
        bpm: null,
        mood_tags: [],
        style_tags: [],
        instrument_tags: [],
      };

      mockDb.oneOrNone.mockResolvedValue(mockRecipe);
      mockDb.none.mockResolvedValue(null);

      (sunoApiClient.generateTrack as jest.Mock).mockResolvedValue({
        sunoTrackId: 'suno-789',
        status: 'generating',
      });

      (sunoApiClient.getTrackStatus as jest.Mock).mockResolvedValue({
        status: 'failed',
        error: 'Invalid prompt',
      });

      (sunoApiClient.sleep as jest.Mock).mockResolvedValue(undefined);

      const job = {
        data: {
          trackId: 'track-4',
          recipeId: 'recipe-1',
          testMode: false,
        },
      };

      await expect(processJob(job)).rejects.toThrow(
        'Track generation failed: Invalid prompt'
      );
    });

    it('should throw error if completed track has no audio URL', async () => {
      const mockRecipe = {
        id: 'recipe-1',
        prompt: 'Test music',
        bpm: null,
        mood_tags: [],
        style_tags: [],
        instrument_tags: [],
      };

      mockDb.oneOrNone.mockResolvedValue(mockRecipe);
      mockDb.none.mockResolvedValue(null);

      (sunoApiClient.generateTrack as jest.Mock).mockResolvedValue({
        sunoTrackId: 'suno-999',
        status: 'generating',
      });

      (sunoApiClient.getTrackStatus as jest.Mock).mockResolvedValue({
        status: 'completed',
        audioUrl: null, // Missing audio URL
      });

      (sunoApiClient.sleep as jest.Mock).mockResolvedValue(undefined);

      const job = {
        data: {
          trackId: 'track-5',
          recipeId: 'recipe-1',
          testMode: false,
        },
      };

      await expect(processJob(job)).rejects.toThrow(
        'Track completed but no audio URL provided'
      );
    });

    it('should timeout after max polling attempts', async () => {
      const mockRecipe = {
        id: 'recipe-1',
        prompt: 'Test music',
        bpm: null,
        mood_tags: [],
        style_tags: [],
        instrument_tags: [],
      };

      mockDb.oneOrNone.mockResolvedValue(mockRecipe);
      mockDb.none.mockResolvedValue(null);

      (sunoApiClient.generateTrack as jest.Mock).mockResolvedValue({
        sunoTrackId: 'suno-timeout',
        status: 'generating',
      });

      // Always return 'generating' status
      (sunoApiClient.getTrackStatus as jest.Mock).mockResolvedValue({
        status: 'generating',
      });

      (sunoApiClient.sleep as jest.Mock).mockResolvedValue(undefined);

      const job = {
        data: {
          trackId: 'track-6',
          recipeId: 'recipe-1',
          testMode: false,
        },
      };

      await expect(processJob(job)).rejects.toThrow(/timeout/i);

      // Verify it polled the maximum number of times (24 attempts)
      expect(sunoApiClient.getTrackStatus).toHaveBeenCalledTimes(24);
    });

    it('should handle immediate completion with audio URL', async () => {
      const mockRecipe = {
        id: 'recipe-1',
        prompt: 'Quick test',
        bpm: 140,
        mood_tags: ['upbeat'],
        style_tags: [],
        instrument_tags: [],
      };

      mockDb.oneOrNone.mockResolvedValue(mockRecipe);
      mockDb.none.mockResolvedValue(null);

      (sunoApiClient.generateTrack as jest.Mock).mockResolvedValue({
        sunoTrackId: 'suno-immediate',
        status: 'completed',
      });

      (sunoApiClient.getTrackStatus as jest.Mock).mockResolvedValue({
        status: 'completed',
        audioUrl: 'https://example.com/immediate.mp3',
        duration: 120,
      });

      const job = {
        data: {
          trackId: 'track-7',
          recipeId: 'recipe-1',
          testMode: true,
        },
      };

      await processJob(job);

      // Should not poll, just get status once
      expect(sunoApiClient.getTrackStatus).toHaveBeenCalledTimes(1);
      expect(sunoApiClient.sleep).not.toHaveBeenCalled();

      // Verify track was updated
      expect(mockDb.none).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE tracks'),
        expect.arrayContaining(['https://example.com/immediate.mp3', 120, 'track-7'])
      );
    });
  });
});
