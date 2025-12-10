/**
 * Unit tests for campaignService
 * Tests campaign CRUD operations with mocked database
 */

import {
  createCampaign,
  getCampaigns,
  getCampaignById,
  updateCampaign,
  deleteCampaign,
  verifyCampaignOwnership,
} from '../../src/services/campaignService';
import {
  ConflictError,
  NotFoundError,
  ForbiddenError,
  ValidationError,
} from '../../src/types';

// Mock logger
jest.mock('../../src/utils/logger', () => {
  const mockLogger = {
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    silent: true,
  };
  return {
    __esModule: true,
    default: mockLogger,
  };
});

describe('CampaignService', () => {
  let mockDb: any;
  const userId = 'user-123';
  const otherUserId = 'user-456';
  const campaignId = 'campaign-123';

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock database with pg-promise methods
    mockDb = {
      one: jest.fn(),
      oneOrNone: jest.fn(),
      any: jest.fn(),
      none: jest.fn(),
      result: jest.fn(),
    };
  });

  describe('createCampaign', () => {
    it('should create campaign with valid data', async () => {
      const mockCampaign = {
        id: campaignId,
        user_id: userId,
        name: 'Test Campaign',
        system_name: 'D&D 5e',
        description: 'Test description',
        created_at: new Date(),
        updated_at: new Date(),
        metadata: { setting: 'Forgotten Realms' },
      };

      mockDb.one.mockResolvedValue(mockCampaign);

      const result = await createCampaign(mockDb, userId, {
        name: 'Test Campaign',
        system_name: 'D&D 5e',
        description: 'Test description',
        metadata: { setting: 'Forgotten Realms' },
      });

      expect(result).toEqual(mockCampaign);
      expect(mockDb.one).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO campaigns'),
        [userId, 'Test Campaign', 'D&D 5e', 'Test description', { setting: 'Forgotten Realms' }]
      );
    });

    it('should trim whitespace from name and system_name', async () => {
      const mockCampaign = {
        id: campaignId,
        user_id: userId,
        name: 'Trimmed Campaign',
        system_name: 'D&D 5e',
        description: null,
        created_at: new Date(),
        updated_at: new Date(),
        metadata: {},
      };

      mockDb.one.mockResolvedValue(mockCampaign);

      await createCampaign(mockDb, userId, {
        name: '  Trimmed Campaign  ',
        system_name: '  D&D 5e  ',
      });

      expect(mockDb.one).toHaveBeenCalledWith(
        expect.any(String),
        [userId, 'Trimmed Campaign', 'D&D 5e', null, {}]
      );
    });

    it('should set empty object as metadata if not provided', async () => {
      const mockCampaign = {
        id: campaignId,
        user_id: userId,
        name: 'Test Campaign',
        system_name: 'D&D 5e',
        description: null,
        created_at: new Date(),
        updated_at: new Date(),
        metadata: {},
      };

      mockDb.one.mockResolvedValue(mockCampaign);

      await createCampaign(mockDb, userId, {
        name: 'Test Campaign',
        system_name: 'D&D 5e',
      });

      expect(mockDb.one).toHaveBeenCalledWith(
        expect.any(String),
        [userId, 'Test Campaign', 'D&D 5e', null, {}]
      );
    });

    it('should throw ConflictError for duplicate campaign name', async () => {
      const error = new Error('duplicate key value violates unique constraint');
      (error as any).code = '23505';
      (error as any).constraint = 'unique_campaign_name_per_user';

      mockDb.one.mockRejectedValue(error);

      await expect(
        createCampaign(mockDb, userId, {
          name: 'Duplicate Campaign',
          system_name: 'D&D 5e',
        })
      ).rejects.toThrow(ConflictError);
      await expect(
        createCampaign(mockDb, userId, {
          name: 'Duplicate Campaign',
          system_name: 'D&D 5e',
        })
      ).rejects.toThrow('Campaign with name "Duplicate Campaign" already exists');
    });

    it('should allow duplicate campaign name for different users', async () => {
      const mockCampaign = {
        id: 'campaign-789',
        user_id: otherUserId,
        name: 'Test Campaign',
        system_name: 'D&D 5e',
        description: null,
        created_at: new Date(),
        updated_at: new Date(),
        metadata: {},
      };

      mockDb.one.mockResolvedValue(mockCampaign);

      const result = await createCampaign(mockDb, otherUserId, {
        name: 'Test Campaign',
        system_name: 'D&D 5e',
      });

      expect(result.user_id).toBe(otherUserId);
    });
  });

  describe('getCampaigns', () => {
    it('should return empty list for user with no campaigns', async () => {
      mockDb.one.mockResolvedValue({ count: '0' });
      mockDb.any.mockResolvedValue([]);

      const result = await getCampaigns(mockDb, userId);

      expect(result).toEqual({
        data: [],
        total: 0,
        skip: 0,
        limit: 20,
      });
    });

    it('should return only campaigns owned by user', async () => {
      const mockCampaigns = [
        {
          id: campaignId,
          name: 'Campaign 1',
          system_name: 'D&D 5e',
          created_at: new Date(),
          updated_at: new Date(),
          session_count: 5,
          resource_count: 3,
        },
      ];

      mockDb.one.mockResolvedValue({ count: '1' });
      mockDb.any.mockResolvedValue(mockCampaigns);

      const result = await getCampaigns(mockDb, userId);

      expect(result.data).toEqual(mockCampaigns);
      expect(result.total).toBe(1);
      expect(mockDb.any).toHaveBeenCalledWith(
        expect.stringContaining('WHERE c.user_id = $1'),
        [userId, 20, 0]
      );
    });

    it('should paginate correctly', async () => {
      mockDb.one.mockResolvedValue({ count: '50' });
      mockDb.any.mockResolvedValue([]);

      await getCampaigns(mockDb, userId, { skip: 20, limit: 10 });

      expect(mockDb.any).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT $2 OFFSET $3'),
        [userId, 10, 20]
      );
    });

    it('should sort by created_at desc by default', async () => {
      mockDb.one.mockResolvedValue({ count: '0' });
      mockDb.any.mockResolvedValue([]);

      await getCampaigns(mockDb, userId);

      expect(mockDb.any).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY c.created_at desc'),
        expect.any(Array)
      );
    });

    it('should sort by name asc when specified', async () => {
      mockDb.one.mockResolvedValue({ count: '0' });
      mockDb.any.mockResolvedValue([]);

      await getCampaigns(mockDb, userId, { sort: 'name', order: 'asc' });

      expect(mockDb.any).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY c.name asc'),
        expect.any(Array)
      );
    });

    it('should sort by updated_at desc when specified', async () => {
      mockDb.one.mockResolvedValue({ count: '0' });
      mockDb.any.mockResolvedValue([]);

      await getCampaigns(mockDb, userId, { sort: 'updated_at', order: 'desc' });

      expect(mockDb.any).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY c.updated_at desc'),
        expect.any(Array)
      );
    });

    it('should enforce max limit of 100', async () => {
      mockDb.one.mockResolvedValue({ count: '200' });
      mockDb.any.mockResolvedValue([]);

      await getCampaigns(mockDb, userId, { limit: 500 });

      expect(mockDb.any).toHaveBeenCalledWith(
        expect.any(String),
        [userId, 100, 0]
      );
    });

    it('should enforce min skip of 0', async () => {
      mockDb.one.mockResolvedValue({ count: '10' });
      mockDb.any.mockResolvedValue([]);

      await getCampaigns(mockDb, userId, { skip: -10 });

      expect(mockDb.any).toHaveBeenCalledWith(
        expect.any(String),
        [userId, 20, 0]
      );
    });

    it('should throw ValidationError for invalid sort field', async () => {
      await expect(
        getCampaigns(mockDb, userId, { sort: 'invalid' as any })
      ).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError for invalid order', async () => {
      await expect(
        getCampaigns(mockDb, userId, { order: 'invalid' as any })
      ).rejects.toThrow(ValidationError);
    });

    it('should return correct aggregated counts', async () => {
      const mockCampaigns = [
        {
          id: campaignId,
          name: 'Campaign 1',
          system_name: 'D&D 5e',
          created_at: new Date(),
          updated_at: new Date(),
          session_count: 5,
          resource_count: 3,
        },
      ];

      mockDb.one.mockResolvedValue({ count: '1' });
      mockDb.any.mockResolvedValue(mockCampaigns);

      const result = await getCampaigns(mockDb, userId);

      expect(result.data[0].session_count).toBe(5);
      expect(result.data[0].resource_count).toBe(3);
    });
  });

  describe('getCampaignById', () => {
    it('should return campaign with aggregated counts', async () => {
      const mockCampaign = {
        id: campaignId,
        user_id: userId,
        name: 'Test Campaign',
        system_name: 'D&D 5e',
        description: 'Test description',
        created_at: new Date(),
        updated_at: new Date(),
        metadata: {},
        session_count: 5,
        resource_count: 3,
        generator_count: 7,
      };

      mockDb.oneOrNone.mockResolvedValue(mockCampaign);

      const result = await getCampaignById(mockDb, userId, campaignId);

      expect(result).toEqual(mockCampaign);
      expect(mockDb.oneOrNone).toHaveBeenCalledWith(
        expect.stringContaining('LEFT JOIN sessions'),
        [campaignId]
      );
    });

    it('should throw NotFoundError if campaign does not exist', async () => {
      mockDb.oneOrNone.mockResolvedValue(null);

      await expect(
        getCampaignById(mockDb, userId, 'nonexistent-id')
      ).rejects.toThrow(NotFoundError);
    });

    it('should throw ForbiddenError if user does not own campaign', async () => {
      const mockCampaign = {
        id: campaignId,
        user_id: otherUserId,
        name: 'Test Campaign',
        system_name: 'D&D 5e',
        description: 'Test description',
        created_at: new Date(),
        updated_at: new Date(),
        metadata: {},
        session_count: 5,
        resource_count: 3,
        generator_count: 7,
      };

      mockDb.oneOrNone.mockResolvedValue(mockCampaign);

      await expect(
        getCampaignById(mockDb, userId, campaignId)
      ).rejects.toThrow(ForbiddenError);
      await expect(
        getCampaignById(mockDb, userId, campaignId)
      ).rejects.toThrow('You do not have permission to access this campaign');
    });

    it('should return zero counts for campaign with no related data', async () => {
      const mockCampaign = {
        id: campaignId,
        user_id: userId,
        name: 'Empty Campaign',
        system_name: 'D&D 5e',
        description: null,
        created_at: new Date(),
        updated_at: new Date(),
        metadata: {},
        session_count: 0,
        resource_count: 0,
        generator_count: 0,
      };

      mockDb.oneOrNone.mockResolvedValue(mockCampaign);

      const result = await getCampaignById(mockDb, userId, campaignId);

      expect(result.session_count).toBe(0);
      expect(result.resource_count).toBe(0);
      expect(result.generator_count).toBe(0);
    });
  });

  describe('updateCampaign', () => {
    beforeEach(() => {
      // Mock ownership verification
      mockDb.oneOrNone.mockResolvedValue({ user_id: userId });
    });

    it('should update name only', async () => {
      const mockCampaign = {
        id: campaignId,
        user_id: userId,
        name: 'Updated Name',
        system_name: 'D&D 5e',
        description: 'Old description',
        created_at: new Date(),
        updated_at: new Date(),
        metadata: {},
      };

      mockDb.one.mockResolvedValue(mockCampaign);

      const result = await updateCampaign(mockDb, userId, campaignId, {
        name: 'Updated Name',
      });

      expect(result.name).toBe('Updated Name');
      expect(mockDb.one).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE campaigns'),
        ['Updated Name', campaignId]
      );
    });

    it('should update system_name only', async () => {
      const mockCampaign = {
        id: campaignId,
        user_id: userId,
        name: 'Test Campaign',
        system_name: 'Pathfinder 2e',
        description: null,
        created_at: new Date(),
        updated_at: new Date(),
        metadata: {},
      };

      mockDb.one.mockResolvedValue(mockCampaign);

      const result = await updateCampaign(mockDb, userId, campaignId, {
        system_name: 'Pathfinder 2e',
      });

      expect(result.system_name).toBe('Pathfinder 2e');
    });

    it('should update description only', async () => {
      const mockCampaign = {
        id: campaignId,
        user_id: userId,
        name: 'Test Campaign',
        system_name: 'D&D 5e',
        description: 'New description',
        created_at: new Date(),
        updated_at: new Date(),
        metadata: {},
      };

      mockDb.one.mockResolvedValue(mockCampaign);

      const result = await updateCampaign(mockDb, userId, campaignId, {
        description: 'New description',
      });

      expect(result.description).toBe('New description');
    });

    it('should update metadata only', async () => {
      const newMetadata = { setting: 'Eberron', level_range: '5-10' };
      const mockCampaign = {
        id: campaignId,
        user_id: userId,
        name: 'Test Campaign',
        system_name: 'D&D 5e',
        description: null,
        created_at: new Date(),
        updated_at: new Date(),
        metadata: newMetadata,
      };

      mockDb.one.mockResolvedValue(mockCampaign);

      const result = await updateCampaign(mockDb, userId, campaignId, {
        metadata: newMetadata,
      });

      expect(result.metadata).toEqual(newMetadata);
    });

    it('should update multiple fields', async () => {
      const mockCampaign = {
        id: campaignId,
        user_id: userId,
        name: 'Updated Campaign',
        system_name: 'Pathfinder 2e',
        description: 'Updated description',
        created_at: new Date(),
        updated_at: new Date(),
        metadata: { new: 'data' },
      };

      mockDb.one.mockResolvedValue(mockCampaign);

      const result = await updateCampaign(mockDb, userId, campaignId, {
        name: 'Updated Campaign',
        system_name: 'Pathfinder 2e',
        description: 'Updated description',
      });

      expect(result.name).toBe('Updated Campaign');
      expect(result.system_name).toBe('Pathfinder 2e');
    });

    it('should return current campaign if no updates provided', async () => {
      const mockCampaign = {
        id: campaignId,
        user_id: userId,
        name: 'Test Campaign',
        system_name: 'D&D 5e',
        description: null,
        created_at: new Date(),
        updated_at: new Date(),
        metadata: {},
        session_count: 5,
        resource_count: 3,
        generator_count: 7,
      };

      // First call for ownership verification, second for getCampaignById
      mockDb.oneOrNone
        .mockResolvedValueOnce({ user_id: userId })
        .mockResolvedValueOnce(mockCampaign);

      const result = await updateCampaign(mockDb, userId, campaignId, {});

      expect(result).toEqual(mockCampaign);
      expect(mockDb.one).not.toHaveBeenCalled();
    });

    it('should throw ForbiddenError if user does not own campaign', async () => {
      mockDb.oneOrNone.mockResolvedValue({ user_id: otherUserId });

      await expect(
        updateCampaign(mockDb, userId, campaignId, { name: 'New Name' })
      ).rejects.toThrow(ForbiddenError);
    });

    it('should throw NotFoundError if campaign does not exist', async () => {
      mockDb.oneOrNone.mockResolvedValue(null);

      await expect(
        updateCampaign(mockDb, userId, 'nonexistent-id', { name: 'New Name' })
      ).rejects.toThrow(NotFoundError);
    });

    it('should throw ConflictError for duplicate name', async () => {
      const error = new Error('duplicate key value violates unique constraint');
      (error as any).code = '23505';
      (error as any).constraint = 'unique_campaign_name_per_user';

      mockDb.one.mockRejectedValue(error);

      await expect(
        updateCampaign(mockDb, userId, campaignId, { name: 'Duplicate Name' })
      ).rejects.toThrow(ConflictError);
    });

    it('should trim whitespace from updated fields', async () => {
      const mockCampaign = {
        id: campaignId,
        user_id: userId,
        name: 'Trimmed Name',
        system_name: 'D&D 5e',
        description: 'Trimmed description',
        created_at: new Date(),
        updated_at: new Date(),
        metadata: {},
      };

      mockDb.one.mockResolvedValue(mockCampaign);

      await updateCampaign(mockDb, userId, campaignId, {
        name: '  Trimmed Name  ',
        description: '  Trimmed description  ',
      });

      expect(mockDb.one).toHaveBeenCalledWith(
        expect.any(String),
        ['Trimmed Name', 'Trimmed description', campaignId]
      );
    });
  });

  describe('deleteCampaign', () => {
    it('should delete campaign successfully', async () => {
      mockDb.oneOrNone.mockResolvedValue({ user_id: userId });
      mockDb.result.mockResolvedValue({ rowCount: 1 });

      await deleteCampaign(mockDb, userId, campaignId);

      expect(mockDb.result).toHaveBeenCalledWith(
        'DELETE FROM campaigns WHERE id = $1',
        [campaignId]
      );
    });

    it('should throw ForbiddenError if user does not own campaign', async () => {
      mockDb.oneOrNone.mockResolvedValue({ user_id: otherUserId });

      await expect(
        deleteCampaign(mockDb, userId, campaignId)
      ).rejects.toThrow(ForbiddenError);
    });

    it('should throw NotFoundError if campaign does not exist', async () => {
      mockDb.oneOrNone.mockResolvedValue(null);

      await expect(
        deleteCampaign(mockDb, userId, 'nonexistent-id')
      ).rejects.toThrow(NotFoundError);
    });

    it('should throw NotFoundError if delete returns zero rows', async () => {
      mockDb.oneOrNone.mockResolvedValue({ user_id: userId });
      mockDb.result.mockResolvedValue({ rowCount: 0 });

      await expect(
        deleteCampaign(mockDb, userId, campaignId)
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('verifyCampaignOwnership', () => {
    it('should pass for owner', async () => {
      mockDb.oneOrNone.mockResolvedValue({ user_id: userId });

      await expect(
        verifyCampaignOwnership(mockDb, userId, campaignId)
      ).resolves.not.toThrow();
    });

    it('should throw ForbiddenError for non-owner', async () => {
      mockDb.oneOrNone.mockResolvedValue({ user_id: otherUserId });

      await expect(
        verifyCampaignOwnership(mockDb, userId, campaignId)
      ).rejects.toThrow(ForbiddenError);
    });

    it('should throw NotFoundError if campaign does not exist', async () => {
      mockDb.oneOrNone.mockResolvedValue(null);

      await expect(
        verifyCampaignOwnership(mockDb, userId, 'nonexistent-id')
      ).rejects.toThrow(NotFoundError);
    });
  });
});
