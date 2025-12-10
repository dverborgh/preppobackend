/**
 * Unit tests for generatorService
 */

import * as generatorService from '../../../src/services/generatorService';
import { verifyCampaignOwnership } from '../../../src/services/campaignService';
import { ValidationError, NotFoundError } from '../../../src/types';

// Mock dependencies
jest.mock('../../../src/services/campaignService');
jest.mock('../../../src/utils/logger');

describe('generatorService', () => {
  let mockDb: any;
  const userId = 'user-123';
  const campaignId = 'campaign-123';
  const generatorId = 'generator-123';

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
      tx: jest.fn((callback) => callback(mockDb)),
    };

    // Mock campaign ownership verification (always passes)
    (verifyCampaignOwnership as jest.Mock).mockResolvedValue(undefined);
  });

  describe('createGenerator', () => {
    const validGeneratorData = {
      name: 'Test Generator',
      description: 'A test generator',
      mode: 'table' as const,
      output_schema: {
        type: 'object',
        properties: {
          result: { type: 'string' },
        },
      },
      tables: [
        {
          name: 'Main Table',
          entries: [
            {
              entry_key: 'entry1',
              entry_text: 'Result 1',
              weight: 10,
            },
            {
              entry_key: 'entry2',
              entry_text: 'Result 2',
              weight: 20,
            },
          ],
        },
      ],
    };

    it('should create a generator with table successfully', async () => {
      const generatorResult = {
        id: generatorId,
        campaign_id: campaignId,
        name: validGeneratorData.name,
        description: validGeneratorData.description,
        mode: validGeneratorData.mode,
        output_schema: validGeneratorData.output_schema,
        primary_table_id: null,
        status: 'active',
        created_at: new Date(),
        updated_at: new Date(),
      };

      const tableResult = {
        id: 'table-123',
        generator_id: generatorId,
        name: 'Main Table',
        roll_method: 'weighted_random',
        created_at: new Date(),
      };

      const entryResults = validGeneratorData.tables[0].entries.map((e, i) => ({
        id: `entry-${i}`,
        table_id: tableResult.id,
        entry_key: e.entry_key,
        entry_text: e.entry_text,
        weight: e.weight || 1,
        display_order: 0,
        created_at: new Date(),
      }));

      mockDb.tx = jest.fn(async (callback) => {
        // Mock sequential calls within transaction
        mockDb.one
          .mockResolvedValueOnce(generatorResult) // INSERT generator
          .mockResolvedValueOnce(tableResult) // INSERT table
          .mockResolvedValueOnce(entryResults[0]) // INSERT entry 1
          .mockResolvedValueOnce(entryResults[1]); // INSERT entry 2

        mockDb.none = jest.fn().mockResolvedValue(undefined); // UPDATE generator with primary_table_id

        return await callback(mockDb);
      });

      const result = await generatorService.createGenerator(
        mockDb,
        userId,
        campaignId,
        validGeneratorData
      );

      expect(verifyCampaignOwnership).toHaveBeenCalledWith(mockDb, userId, campaignId);
      expect(result).toHaveProperty('id', generatorId);
      expect(result).toHaveProperty('tables');
      expect(result.tables).toHaveLength(1);
      expect(result.tables[0].entries).toHaveLength(2);
    });

    it('should reject generator with empty name', async () => {
      const invalidData = {
        ...validGeneratorData,
        name: '',
      };

      await expect(
        generatorService.createGenerator(mockDb, userId, campaignId, invalidData)
      ).rejects.toThrow(ValidationError);
    });

    it('should reject generator with name exceeding 255 characters', async () => {
      const invalidData = {
        ...validGeneratorData,
        name: 'a'.repeat(256),
      };

      await expect(
        generatorService.createGenerator(mockDb, userId, campaignId, invalidData)
      ).rejects.toThrow(ValidationError);
    });

    it('should reject generator with invalid mode', async () => {
      const invalidData = {
        ...validGeneratorData,
        mode: 'invalid' as any,
      };

      await expect(
        generatorService.createGenerator(mockDb, userId, campaignId, invalidData)
      ).rejects.toThrow(ValidationError);
    });

    it('should reject table mode generator without tables', async () => {
      const invalidData = {
        ...validGeneratorData,
        tables: [],
      };

      await expect(
        generatorService.createGenerator(mockDb, userId, campaignId, invalidData)
      ).rejects.toThrow(ValidationError);
    });

    it('should reject generator with invalid output schema (not object type)', async () => {
      const invalidData = {
        ...validGeneratorData,
        output_schema: {
          type: 'string',
        },
      };

      await expect(
        generatorService.createGenerator(mockDb, userId, campaignId, invalidData)
      ).rejects.toThrow(ValidationError);
    });

    it('should reject generator with schema depth exceeding 5 levels', async () => {
      const invalidData = {
        ...validGeneratorData,
        output_schema: {
          type: 'object',
          properties: {
            level1: {
              type: 'object',
              properties: {
                level2: {
                  type: 'object',
                  properties: {
                    level3: {
                      type: 'object',
                      properties: {
                        level4: {
                          type: 'object',
                          properties: {
                            level5: {
                              type: 'object',
                              properties: {
                                level6: { type: 'string' },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      };

      await expect(
        generatorService.createGenerator(mockDb, userId, campaignId, invalidData)
      ).rejects.toThrow(ValidationError);
    });

    it('should reject table with duplicate entry keys', async () => {
      const invalidData = {
        ...validGeneratorData,
        tables: [
          {
            name: 'Main Table',
            entries: [
              { entry_key: 'entry1', entry_text: 'Result 1', weight: 10 },
              { entry_key: 'entry1', entry_text: 'Result 2', weight: 20 },
            ],
          },
        ],
      };

      await expect(
        generatorService.createGenerator(mockDb, userId, campaignId, invalidData)
      ).rejects.toThrow(ValidationError);
    });

    it('should reject entry with invalid weight (< 1)', async () => {
      const invalidData = {
        ...validGeneratorData,
        tables: [
          {
            name: 'Main Table',
            entries: [{ entry_key: 'entry1', entry_text: 'Result 1', weight: 0 }],
          },
        ],
      };

      await expect(
        generatorService.createGenerator(mockDb, userId, campaignId, invalidData)
      ).rejects.toThrow(ValidationError);
    });

    it('should reject entry with weight > 1000', async () => {
      const invalidData = {
        ...validGeneratorData,
        tables: [
          {
            name: 'Main Table',
            entries: [{ entry_key: 'entry1', entry_text: 'Result 1', weight: 1001 }],
          },
        ],
      };

      await expect(
        generatorService.createGenerator(mockDb, userId, campaignId, invalidData)
      ).rejects.toThrow(ValidationError);
    });

    it('should reject table with more than 100 entries', async () => {
      const tooManyEntries = Array.from({ length: 101 }, (_, i) => ({
        entry_key: `entry${i}`,
        entry_text: `Result ${i}`,
        weight: 10,
      }));

      const invalidData = {
        ...validGeneratorData,
        tables: [
          {
            name: 'Main Table',
            entries: tooManyEntries,
          },
        ],
      };

      await expect(
        generatorService.createGenerator(mockDb, userId, campaignId, invalidData)
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('getGenerator', () => {
    it('should retrieve generator with tables and entries', async () => {
      const generator = {
        id: generatorId,
        campaign_id: campaignId,
        name: 'Test Generator',
        mode: 'table',
        status: 'active',
      };

      const tables = [
        {
          id: 'table-123',
          generator_id: generatorId,
          name: 'Main Table',
          roll_method: 'weighted_random',
        },
      ];

      const entries = [
        {
          id: 'entry-1',
          table_id: 'table-123',
          entry_key: 'entry1',
          entry_text: 'Result 1',
          weight: 10,
        },
      ];

      mockDb.oneOrNone.mockResolvedValue(generator);
      mockDb.any.mockResolvedValueOnce(tables).mockResolvedValueOnce(entries);

      const result = await generatorService.getGenerator(
        mockDb,
        userId,
        campaignId,
        generatorId
      );

      expect(verifyCampaignOwnership).toHaveBeenCalledWith(mockDb, userId, campaignId);
      expect(result).toHaveProperty('id', generatorId);
      expect(result.tables).toHaveLength(1);
      expect(result.tables[0].entries).toHaveLength(1);
    });

    it('should throw NotFoundError if generator does not exist', async () => {
      mockDb.oneOrNone.mockResolvedValue(null);

      await expect(
        generatorService.getGenerator(mockDb, userId, campaignId, generatorId)
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('listGenerators', () => {
    it('should list generators with pagination', async () => {
      const generators = [
        { id: 'gen-1', name: 'Generator 1', status: 'active' },
        { id: 'gen-2', name: 'Generator 2', status: 'active' },
      ];

      mockDb.one.mockResolvedValue({ count: '2' });
      mockDb.any.mockResolvedValue(generators);

      const result = await generatorService.listGenerators(mockDb, userId, campaignId, {
        skip: 0,
        limit: 50,
      });

      expect(verifyCampaignOwnership).toHaveBeenCalledWith(mockDb, userId, campaignId);
      expect(result.data).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.skip).toBe(0);
      expect(result.limit).toBe(50);
    });

    it('should filter generators by status', async () => {
      mockDb.one.mockResolvedValue({ count: '1' });
      mockDb.any.mockResolvedValue([{ id: 'gen-1', status: 'archived' }]);

      const result = await generatorService.listGenerators(mockDb, userId, campaignId, {
        status: 'archived',
      });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].status).toBe('archived');
    });

    it('should reject invalid status filter', async () => {
      await expect(
        generatorService.listGenerators(mockDb, userId, campaignId, {
          status: 'invalid' as any,
        })
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('updateGenerator', () => {
    it('should update generator name', async () => {
      mockDb.oneOrNone.mockResolvedValue({ campaign_id: campaignId });
      mockDb.one.mockResolvedValue({
        id: generatorId,
        name: 'Updated Name',
        status: 'active',
      });

      const result = await generatorService.updateGenerator(
        mockDb,
        userId,
        campaignId,
        generatorId,
        { name: 'Updated Name' }
      );

      expect(verifyCampaignOwnership).toHaveBeenCalledWith(mockDb, userId, campaignId);
      expect(result.name).toBe('Updated Name');
    });

    it('should throw NotFoundError if generator does not exist', async () => {
      mockDb.oneOrNone.mockResolvedValue(null);

      await expect(
        generatorService.updateGenerator(mockDb, userId, campaignId, generatorId, {
          name: 'Updated',
        })
      ).rejects.toThrow(NotFoundError);
    });

    it('should reject empty name', async () => {
      mockDb.oneOrNone.mockResolvedValue({ campaign_id: campaignId });

      await expect(
        generatorService.updateGenerator(mockDb, userId, campaignId, generatorId, {
          name: '',
        })
      ).rejects.toThrow(ValidationError);
    });

    it('should reject invalid status', async () => {
      mockDb.oneOrNone.mockResolvedValue({ campaign_id: campaignId });

      await expect(
        generatorService.updateGenerator(mockDb, userId, campaignId, generatorId, {
          status: 'invalid' as any,
        })
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('deleteGenerator', () => {
    it('should delete generator successfully', async () => {
      mockDb.oneOrNone.mockResolvedValue({ campaign_id: campaignId });
      mockDb.result.mockResolvedValue({ rowCount: 1 });

      await generatorService.deleteGenerator(mockDb, userId, campaignId, generatorId);

      expect(verifyCampaignOwnership).toHaveBeenCalledWith(mockDb, userId, campaignId);
      expect(mockDb.result).toHaveBeenCalled();
    });

    it('should throw NotFoundError if generator does not exist', async () => {
      mockDb.oneOrNone.mockResolvedValue(null);

      await expect(
        generatorService.deleteGenerator(mockDb, userId, campaignId, generatorId)
      ).rejects.toThrow(NotFoundError);
    });

    it('should throw NotFoundError if campaign mismatch', async () => {
      mockDb.oneOrNone.mockResolvedValue({ campaign_id: 'different-campaign' });

      await expect(
        generatorService.deleteGenerator(mockDb, userId, campaignId, generatorId)
      ).rejects.toThrow(NotFoundError);
    });
  });
});
