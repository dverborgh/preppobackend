/**
 * Unit tests for generatorRollService
 */

import * as generatorRollService from '../../../src/services/generatorRollService';
import { verifyCampaignOwnership } from '../../../src/services/campaignService';
import { ValidationError, NotFoundError } from '../../../src/types';

// Mock dependencies
jest.mock('../../../src/services/campaignService');
jest.mock('../../../src/utils/logger');
jest.mock('seedrandom');

describe('generatorRollService', () => {
  let mockDb: any;
  const userId = 'user-123';
  const campaignId = 'campaign-123';
  const generatorId = 'generator-123';
  const sessionId = 'session-123';
  const sceneId = 'scene-123';

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Mock database
    mockDb = {
      one: jest.fn(),
      oneOrNone: jest.fn(),
      any: jest.fn(),
      none: jest.fn(),
      result: jest.fn(),
    };

    // Mock campaign ownership verification (always passes)
    (verifyCampaignOwnership as jest.Mock).mockResolvedValue(undefined);
  });

  describe('executeRoll', () => {
    const mockGenerator = {
      id: generatorId,
      name: 'Test Generator',
      campaign_id: campaignId,
      mode: 'table',
      output_schema: {
        type: 'object',
        properties: {
          result: { type: 'string' },
        },
      },
      primary_table_id: 'table-123',
      status: 'active',
    };

    const mockEntries = [
      {
        id: 'entry-1',
        table_id: 'table-123',
        entry_key: 'common',
        entry_text: 'Common result {"result": "common"}',
        weight: 60,
        display_order: 0,
      },
      {
        id: 'entry-2',
        table_id: 'table-123',
        entry_key: 'rare',
        entry_text: 'Rare result {"result": "rare"}',
        weight: 30,
        display_order: 1,
      },
      {
        id: 'entry-3',
        table_id: 'table-123',
        entry_key: 'legendary',
        entry_text: 'Legendary result {"result": "legendary"}',
        weight: 10,
        display_order: 2,
      },
    ];

    const mockRollResult = {
      id: 'roll-123',
      generator_id: generatorId,
      session_id: sessionId,
      rolled_value: { result: 'common' },
      random_seed: 'test-seed',
      roll_timestamp: new Date(),
    };

    beforeEach(() => {
      // Mock seedrandom to return deterministic value
      const mockRng = jest.fn(() => 0.5); // Will select middle weight range
      require('seedrandom').mockReturnValue(mockRng);
    });

    it('should execute roll successfully and return result', async () => {
      // Setup mocks for this test
      mockDb.oneOrNone
        .mockResolvedValueOnce({ campaign_id: campaignId }) // Session verification
        .mockResolvedValueOnce(mockGenerator); // Generator fetch
      mockDb.any.mockResolvedValue(mockEntries);
      mockDb.one.mockResolvedValue(mockRollResult);

      const request = {
        session_id: sessionId,
      };

      const result = await generatorRollService.executeRoll(
        mockDb,
        userId,
        campaignId,
        generatorId,
        request
      );

      expect(verifyCampaignOwnership).toHaveBeenCalledWith(mockDb, userId, campaignId);
      expect(result).toHaveProperty('generator_id', generatorId);
      expect(result).toHaveProperty('rolled_value');
      expect(result).toHaveProperty('entry_key');
      expect(result).toHaveProperty('random_seed');
      expect(result).toHaveProperty('latency_ms');
      expect(result.latency_ms).toBeLessThan(300); // Performance requirement
    });

    it('should execute roll with scene ID', async () => {
      // Mock scene verification
      mockDb.oneOrNone
        .mockResolvedValueOnce({ campaign_id: campaignId }) // Session
        .mockResolvedValueOnce({ session_id: sessionId }) // Scene
        .mockResolvedValueOnce(mockGenerator); // Generator
      mockDb.any.mockResolvedValue(mockEntries);
      mockDb.one.mockResolvedValue(mockRollResult);

      const request = {
        session_id: sessionId,
        scene_id: sceneId,
      };

      const result = await generatorRollService.executeRoll(
        mockDb,
        userId,
        campaignId,
        generatorId,
        request
      );

      expect(result).toBeDefined();
    });

    it('should execute roll in test mode without logging', async () => {
      // In test mode, session validation is skipped, so only generator is fetched
      mockDb.oneOrNone.mockResolvedValueOnce(mockGenerator);
      mockDb.any.mockResolvedValue(mockEntries);

      const request = {
        session_id: sessionId,
        test_mode: true,
      };

      const result = await generatorRollService.executeRoll(
        mockDb,
        userId,
        campaignId,
        generatorId,
        request
      );

      expect(result.id).toBeUndefined(); // No roll ID in test mode
      expect(mockDb.one).not.toHaveBeenCalled();
    });

    it('should use provided seed for deterministic rolls', async () => {
      mockDb.oneOrNone
        .mockResolvedValueOnce({ campaign_id: campaignId })
        .mockResolvedValueOnce(mockGenerator);
      mockDb.any.mockResolvedValue(mockEntries);
      mockDb.one.mockResolvedValue(mockRollResult);

      const request = {
        session_id: sessionId,
        seed: 'custom-seed-123',
      };

      const result = await generatorRollService.executeRoll(
        mockDb,
        userId,
        campaignId,
        generatorId,
        request
      );

      expect(result.random_seed).toBe('custom-seed-123');
      expect(require('seedrandom')).toHaveBeenCalledWith('custom-seed-123');
    });

    it('should throw NotFoundError if session does not exist', async () => {
      mockDb.oneOrNone.mockResolvedValueOnce(null); // Session not found

      const request = {
        session_id: 'nonexistent-session',
      };

      await expect(
        generatorRollService.executeRoll(mockDb, userId, campaignId, generatorId, request)
      ).rejects.toThrow(NotFoundError);
    });

    it('should throw NotFoundError if session belongs to different campaign', async () => {
      mockDb.oneOrNone.mockResolvedValueOnce({ campaign_id: 'different-campaign' });

      const request = {
        session_id: sessionId,
      };

      await expect(
        generatorRollService.executeRoll(mockDb, userId, campaignId, generatorId, request)
      ).rejects.toThrow(NotFoundError);
    });

    it('should throw NotFoundError if generator does not exist', async () => {
      mockDb.oneOrNone
        .mockResolvedValueOnce({ campaign_id: campaignId }) // Session OK
        .mockResolvedValueOnce(null); // Generator not found

      const request = {
        session_id: sessionId,
      };

      await expect(
        generatorRollService.executeRoll(mockDb, userId, campaignId, generatorId, request)
      ).rejects.toThrow(NotFoundError);
    });

    it('should throw ValidationError if generator is not active', async () => {
      const inactiveGenerator = { ...mockGenerator, status: 'archived' };
      mockDb.oneOrNone
        .mockResolvedValueOnce({ campaign_id: campaignId }) // Session
        .mockResolvedValueOnce(inactiveGenerator); // Generator
      mockDb.any.mockResolvedValue(mockEntries);

      const request = {
        session_id: sessionId,
      };

      await expect(
        generatorRollService.executeRoll(mockDb, userId, campaignId, generatorId, request)
      ).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError if generator is not table mode', async () => {
      const llmGenerator = { ...mockGenerator, mode: 'llm' };
      mockDb.oneOrNone
        .mockResolvedValueOnce({ campaign_id: campaignId }) // Session
        .mockResolvedValueOnce(llmGenerator); // Generator
      mockDb.any.mockResolvedValue(mockEntries);

      const request = {
        session_id: sessionId,
      };

      await expect(
        generatorRollService.executeRoll(mockDb, userId, campaignId, generatorId, request)
      ).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError if generator has no entries', async () => {
      mockDb.oneOrNone
        .mockResolvedValueOnce({ campaign_id: campaignId })
        .mockResolvedValueOnce(mockGenerator);
      mockDb.any.mockResolvedValue([]); // No entries

      const request = {
        session_id: sessionId,
      };

      await expect(
        generatorRollService.executeRoll(mockDb, userId, campaignId, generatorId, request)
      ).rejects.toThrow(ValidationError);
    });

    it('should handle weighted selection correctly', async () => {
      // Test that with RNG = 0.0, we get first entry
      const mockRng = jest.fn(() => 0.0);
      require('seedrandom').mockReturnValue(mockRng);

      mockDb.oneOrNone
        .mockResolvedValueOnce({ campaign_id: campaignId })
        .mockResolvedValueOnce(mockGenerator);
      mockDb.any.mockResolvedValue(mockEntries);
      mockDb.one.mockResolvedValue(mockRollResult);

      const request = {
        session_id: sessionId,
      };

      const result = await generatorRollService.executeRoll(
        mockDb,
        userId,
        campaignId,
        generatorId,
        request
      );

      // With weights [60, 30, 10] and RNG = 0.0, should select first entry
      expect(result.entry_key).toBe('common');
    });

    it('should complete roll in under 300ms', async () => {
      mockDb.oneOrNone
        .mockResolvedValueOnce({ campaign_id: campaignId })
        .mockResolvedValueOnce(mockGenerator);
      mockDb.any.mockResolvedValue(mockEntries);
      mockDb.one.mockResolvedValue(mockRollResult);

      const request = {
        session_id: sessionId,
      };

      const startTime = Date.now();
      const result = await generatorRollService.executeRoll(
        mockDb,
        userId,
        campaignId,
        generatorId,
        request
      );
      const endTime = Date.now();

      expect(endTime - startTime).toBeLessThan(300);
      expect(result.latency_ms).toBeLessThan(300);
    });
  });

  describe('getRollHistory', () => {
    it('should retrieve roll history with pagination', async () => {
      const rolls = [
        {
          id: 'roll-1',
          generator_id: generatorId,
          rolled_value: { result: 'common' },
          roll_timestamp: new Date(),
        },
        {
          id: 'roll-2',
          generator_id: generatorId,
          rolled_value: { result: 'rare' },
          roll_timestamp: new Date(),
        },
      ];

      mockDb.oneOrNone.mockResolvedValue({ campaign_id: campaignId });
      mockDb.one.mockResolvedValue({ count: '2' });
      mockDb.any.mockResolvedValue(rolls);

      const result = await generatorRollService.getRollHistory(
        mockDb,
        userId,
        campaignId,
        generatorId,
        { skip: 0, limit: 50 }
      );

      expect(verifyCampaignOwnership).toHaveBeenCalledWith(mockDb, userId, campaignId);
      expect(result.data).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it('should filter roll history by session', async () => {
      mockDb.oneOrNone.mockResolvedValue({ campaign_id: campaignId });
      mockDb.one.mockResolvedValue({ count: '1' });
      mockDb.any.mockResolvedValue([
        { id: 'roll-1', session_id: sessionId, rolled_value: {} },
      ]);

      const result = await generatorRollService.getRollHistory(
        mockDb,
        userId,
        campaignId,
        generatorId,
        { sessionId }
      );

      expect(result.data).toHaveLength(1);
      expect(result.data[0].session_id).toBe(sessionId);
    });

    it('should throw NotFoundError if generator does not exist', async () => {
      mockDb.oneOrNone.mockResolvedValue(null);

      await expect(
        generatorRollService.getRollHistory(mockDb, userId, campaignId, generatorId)
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('getRollStatistics', () => {
    it('should compute roll statistics correctly', async () => {
      mockDb.oneOrNone.mockResolvedValue({ campaign_id: campaignId });
      mockDb.one
        .mockResolvedValueOnce({ count: '100' }) // Total rolls
        .mockResolvedValueOnce(); // For any other one() call

      mockDb.any.mockResolvedValue([
        { entry_key: 'common', count: '60' },
        { entry_key: 'rare', count: '30' },
        { entry_key: 'legendary', count: '10' },
      ]);

      const result = await generatorRollService.getRollStatistics(
        mockDb,
        userId,
        campaignId,
        generatorId
      );

      expect(verifyCampaignOwnership).toHaveBeenCalledWith(mockDb, userId, campaignId);
      expect(result.total_rolls).toBe(100);
      expect(result.entry_distribution).toHaveLength(3);
      expect(result.entry_distribution[0]).toEqual({
        entry_key: 'common',
        count: 60,
        percentage: 60,
      });
    });

    it('should handle zero rolls gracefully', async () => {
      mockDb.oneOrNone.mockResolvedValue({ campaign_id: campaignId });
      mockDb.one.mockResolvedValue({ count: '0' });
      mockDb.any.mockResolvedValue([]);

      const result = await generatorRollService.getRollStatistics(
        mockDb,
        userId,
        campaignId,
        generatorId
      );

      expect(result.total_rolls).toBe(0);
      expect(result.entry_distribution).toHaveLength(0);
    });
  });
});
