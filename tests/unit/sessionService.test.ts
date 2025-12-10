/**
 * Unit tests for sessionService
 * Tests session CRUD operations with mocked database
 */

import {
  createSession,
  getSessions,
  getSessionById,
  updateSession,
  deleteSession,
  activateSession,
  deactivateSession,
} from '../../src/services/sessionService';
import {
  NotFoundError,
  ForbiddenError,
  ValidationError,
} from '../../src/types';
import * as campaignService from '../../src/services/campaignService';

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

// Mock campaignService
jest.mock('../../src/services/campaignService', () => ({
  verifyCampaignOwnership: jest.fn(),
}));

describe('SessionService', () => {
  let mockDb: any;
  const userId = 'user-123';
  const campaignId = 'campaign-123';
  const sessionId = 'session-123';

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock database with pg-promise methods
    mockDb = {
      one: jest.fn(),
      oneOrNone: jest.fn(),
      any: jest.fn(),
      none: jest.fn(),
      result: jest.fn(),
      tx: jest.fn(),
    };

    // Mock verifyCampaignOwnership to resolve by default
    (campaignService.verifyCampaignOwnership as jest.Mock).mockResolvedValue(undefined);
  });

  describe('createSession', () => {
    it('should create session with valid data', async () => {
      const mockSession = {
        id: sessionId,
        campaign_id: campaignId,
        session_number: 1,
        name: 'The Awakening',
        scheduled_date: '2025-12-15',
        description: 'Party wakes in tavern',
        notes: null,
        duration_minutes: null,
        status: 'draft',
        created_at: new Date(),
        updated_at: new Date(),
        preparation_notes: 'Prepare NPCs',
        gm_objectives: ['Introduce villain', 'Establish party'],
        is_active: false,
        started_at: null,
      };

      mockDb.one.mockResolvedValue(mockSession);

      const result = await createSession(mockDb, userId, campaignId, {
        session_number: 1,
        name: 'The Awakening',
        scheduled_date: '2025-12-15',
        description: 'Party wakes in tavern',
        preparation_notes: 'Prepare NPCs',
        gm_objectives: ['Introduce villain', 'Establish party'],
      });

      expect(result).toEqual(mockSession);
      expect(campaignService.verifyCampaignOwnership).toHaveBeenCalledWith(
        mockDb,
        userId,
        campaignId
      );
      expect(mockDb.one).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO sessions'),
        expect.arrayContaining([campaignId, 1, 'The Awakening'])
      );
    });

    it('should trim whitespace from name', async () => {
      const mockSession = {
        id: sessionId,
        campaign_id: campaignId,
        session_number: 1,
        name: 'Trimmed Session',
        scheduled_date: null,
        description: null,
        notes: null,
        duration_minutes: null,
        status: 'draft',
        created_at: new Date(),
        updated_at: new Date(),
        preparation_notes: null,
        gm_objectives: [],
        is_active: false,
        started_at: null,
      };

      mockDb.one.mockResolvedValue(mockSession);

      await createSession(mockDb, userId, campaignId, {
        session_number: 1,
        name: '  Trimmed Session  ',
      });

      expect(mockDb.one).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([campaignId, 1, 'Trimmed Session'])
      );
    });

    it('should throw ValidationError for invalid session_number', async () => {
      await expect(
        createSession(mockDb, userId, campaignId, {
          session_number: 0,
          name: 'Invalid Session',
        })
      ).rejects.toThrow(ValidationError);

      await expect(
        createSession(mockDb, userId, campaignId, {
          session_number: -1,
          name: 'Invalid Session',
        })
      ).rejects.toThrow(ValidationError);

      await expect(
        createSession(mockDb, userId, campaignId, {
          session_number: 1.5,
          name: 'Invalid Session',
        })
      ).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError for empty name', async () => {
      await expect(
        createSession(mockDb, userId, campaignId, {
          session_number: 1,
          name: '',
        })
      ).rejects.toThrow(ValidationError);

      await expect(
        createSession(mockDb, userId, campaignId, {
          session_number: 1,
          name: '   ',
        })
      ).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError for name exceeding 255 characters', async () => {
      await expect(
        createSession(mockDb, userId, campaignId, {
          session_number: 1,
          name: 'a'.repeat(256),
        })
      ).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError for invalid duration_minutes', async () => {
      await expect(
        createSession(mockDb, userId, campaignId, {
          session_number: 1,
          name: 'Test Session',
          duration_minutes: -1,
        })
      ).rejects.toThrow(ValidationError);

      await expect(
        createSession(mockDb, userId, campaignId, {
          session_number: 1,
          name: 'Test Session',
          duration_minutes: 1.5,
        })
      ).rejects.toThrow(ValidationError);
    });

    it('should throw error if campaign ownership verification fails', async () => {
      (campaignService.verifyCampaignOwnership as jest.Mock).mockRejectedValue(
        new ForbiddenError()
      );

      await expect(
        createSession(mockDb, userId, campaignId, {
          session_number: 1,
          name: 'Test Session',
        })
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe('getSessions', () => {
    it('should list sessions for campaign', async () => {
      const mockSessions = [
        {
          id: sessionId,
          campaign_id: campaignId,
          session_number: 2,
          name: 'Session 2',
          status: 'planned',
          scheduled_date: '2025-12-22',
          created_at: new Date(),
          updated_at: new Date(),
          is_active: false,
          scene_count: 3,
        },
        {
          id: 'session-456',
          campaign_id: campaignId,
          session_number: 1,
          name: 'Session 1',
          status: 'completed',
          scheduled_date: '2025-12-15',
          created_at: new Date(),
          updated_at: new Date(),
          is_active: false,
          scene_count: 5,
        },
      ];

      mockDb.one.mockResolvedValue({ count: '2' });
      mockDb.any.mockResolvedValue(mockSessions);

      const result = await getSessions(mockDb, userId, campaignId);

      expect(result).toEqual({
        data: mockSessions,
        total: 2,
        skip: 0,
        limit: 50,
      });
      expect(campaignService.verifyCampaignOwnership).toHaveBeenCalledWith(
        mockDb,
        userId,
        campaignId
      );
    });

    it('should filter sessions by status', async () => {
      mockDb.one.mockResolvedValue({ count: '1' });
      mockDb.any.mockResolvedValue([]);

      await getSessions(mockDb, userId, campaignId, { status: 'draft' });

      expect(mockDb.any).toHaveBeenCalledWith(
        expect.stringContaining("AND s.status = $2"),
        expect.arrayContaining([campaignId, 'draft'])
      );
    });

    it('should apply pagination', async () => {
      mockDb.one.mockResolvedValue({ count: '100' });
      mockDb.any.mockResolvedValue([]);

      await getSessions(mockDb, userId, campaignId, { skip: 10, limit: 25 });

      expect(mockDb.any).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT'),
        expect.arrayContaining([25, 10])
      );
    });

    it('should enforce max limit of 100', async () => {
      mockDb.one.mockResolvedValue({ count: '0' });
      mockDb.any.mockResolvedValue([]);

      await getSessions(mockDb, userId, campaignId, { limit: 200 });

      expect(mockDb.any).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([100]) // Should cap at 100
      );
    });

    it('should throw ValidationError for invalid status', async () => {
      await expect(
        getSessions(mockDb, userId, campaignId, { status: 'invalid' as any })
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('getSessionById', () => {
    it('should return session with counts', async () => {
      const mockSession = {
        id: sessionId,
        campaign_id: campaignId,
        session_number: 1,
        name: 'Test Session',
        status: 'planned',
        description: 'Description',
        scheduled_date: '2025-12-15',
        notes: null,
        duration_minutes: 240,
        gm_objectives: ['Objective 1', 'Objective 2'],
        preparation_notes: 'Notes',
        created_at: new Date(),
        updated_at: new Date(),
        is_active: false,
        started_at: null,
        scene_count: 3,
        packet_count: 1,
      };

      mockDb.oneOrNone.mockResolvedValue(mockSession);

      const result = await getSessionById(mockDb, userId, campaignId, sessionId);

      expect(result).toEqual(mockSession);
      expect(campaignService.verifyCampaignOwnership).toHaveBeenCalledWith(
        mockDb,
        userId,
        campaignId
      );
    });

    it('should throw NotFoundError if session not found', async () => {
      mockDb.oneOrNone.mockResolvedValue(null);

      await expect(
        getSessionById(mockDb, userId, campaignId, sessionId)
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('updateSession', () => {
    const currentSession = {
      status: 'draft',
      campaign_id: campaignId,
    };

    beforeEach(() => {
      mockDb.oneOrNone.mockResolvedValue(currentSession);
    });

    it('should update session with valid data', async () => {
      const updatedSession = {
        id: sessionId,
        campaign_id: campaignId,
        session_number: 1,
        name: 'Updated Session',
        status: 'planned',
        description: 'Updated description',
        scheduled_date: '2025-12-20',
        notes: null,
        duration_minutes: 180,
        gm_objectives: ['Updated objective'],
        preparation_notes: 'Updated notes',
        created_at: new Date(),
        updated_at: new Date(),
        is_active: false,
        started_at: null,
      };

      mockDb.one.mockResolvedValue(updatedSession);

      const result = await updateSession(mockDb, userId, campaignId, sessionId, {
        name: 'Updated Session',
        status: 'planned',
        description: 'Updated description',
      });

      expect(result).toEqual(updatedSession);
      expect(mockDb.one).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE sessions'),
        expect.any(Array)
      );
    });

    it('should validate status transitions', async () => {
      // Valid transition: draft -> planned
      mockDb.oneOrNone.mockResolvedValue({ status: 'draft', campaign_id: campaignId });
      mockDb.one.mockResolvedValue({});

      await expect(
        updateSession(mockDb, userId, campaignId, sessionId, { status: 'planned' })
      ).resolves.toBeDefined();

      // Invalid transition: draft -> completed
      await expect(
        updateSession(mockDb, userId, campaignId, sessionId, { status: 'completed' })
      ).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError for invalid name', async () => {
      await expect(
        updateSession(mockDb, userId, campaignId, sessionId, { name: '' })
      ).rejects.toThrow(ValidationError);

      await expect(
        updateSession(mockDb, userId, campaignId, sessionId, { name: 'a'.repeat(256) })
      ).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError for invalid session_number', async () => {
      await expect(
        updateSession(mockDb, userId, campaignId, sessionId, { session_number: 0 })
      ).rejects.toThrow(ValidationError);
    });

    it('should throw NotFoundError if session not found', async () => {
      mockDb.oneOrNone.mockResolvedValue(null);

      await expect(
        updateSession(mockDb, userId, campaignId, sessionId, { name: 'Test' })
      ).rejects.toThrow(NotFoundError);
    });

    it('should throw NotFoundError if session belongs to different campaign', async () => {
      mockDb.oneOrNone.mockResolvedValue({ status: 'draft', campaign_id: 'other-campaign' });

      await expect(
        updateSession(mockDb, userId, campaignId, sessionId, { name: 'Test' })
      ).rejects.toThrow(NotFoundError);
    });

    it('should return current session if no updates provided', async () => {
      const mockSessionWithCounts = {
        ...currentSession,
        id: sessionId,
        session_number: 1,
        name: 'Test Session',
        scheduled_date: null,
        description: null,
        notes: null,
        duration_minutes: null,
        gm_objectives: [],
        preparation_notes: null,
        created_at: new Date(),
        updated_at: new Date(),
        is_active: false,
        started_at: null,
        scene_count: 0,
        packet_count: 0,
      };

      // First call for status check
      mockDb.oneOrNone.mockResolvedValueOnce(currentSession);
      // Second call for getSessionById
      mockDb.oneOrNone.mockResolvedValueOnce(mockSessionWithCounts);

      const result = await updateSession(mockDb, userId, campaignId, sessionId, {});

      expect(result).toEqual(mockSessionWithCounts);
      expect(mockDb.one).not.toHaveBeenCalled();
    });
  });

  describe('deleteSession', () => {
    it('should delete session', async () => {
      mockDb.oneOrNone.mockResolvedValue({ campaign_id: campaignId });
      mockDb.result.mockResolvedValue({ rowCount: 1 });

      await deleteSession(mockDb, userId, campaignId, sessionId);

      expect(campaignService.verifyCampaignOwnership).toHaveBeenCalledWith(
        mockDb,
        userId,
        campaignId
      );
      expect(mockDb.result).toHaveBeenCalledWith(
        'DELETE FROM sessions WHERE id = $1',
        [sessionId]
      );
    });

    it('should throw NotFoundError if session not found', async () => {
      mockDb.oneOrNone.mockResolvedValue(null);

      await expect(
        deleteSession(mockDb, userId, campaignId, sessionId)
      ).rejects.toThrow(NotFoundError);
    });

    it('should throw NotFoundError if session belongs to different campaign', async () => {
      mockDb.oneOrNone.mockResolvedValue({ campaign_id: 'other-campaign' });

      await expect(
        deleteSession(mockDb, userId, campaignId, sessionId)
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('activateSession', () => {
    it('should activate session and deactivate others', async () => {
      const mockSession = { campaign_id: campaignId, status: 'planned' };
      const activatedSession = {
        id: sessionId,
        campaign_id: campaignId,
        session_number: 1,
        name: 'Test Session',
        status: 'in-progress',
        scheduled_date: null,
        description: null,
        notes: null,
        duration_minutes: null,
        gm_objectives: [],
        preparation_notes: null,
        created_at: new Date(),
        updated_at: new Date(),
        is_active: true,
        started_at: new Date(),
      };

      mockDb.oneOrNone.mockResolvedValue(mockSession);
      mockDb.tx.mockImplementation(async (callback: any) => {
        const mockT = {
          none: jest.fn(),
          one: jest.fn().mockResolvedValue(activatedSession),
        };
        return callback(mockT);
      });

      const result = await activateSession(mockDb, userId, campaignId, sessionId);

      expect(result).toEqual(activatedSession);
      expect(campaignService.verifyCampaignOwnership).toHaveBeenCalledWith(
        mockDb,
        userId,
        campaignId
      );
    });

    it('should throw NotFoundError if session not found', async () => {
      mockDb.oneOrNone.mockResolvedValue(null);

      await expect(
        activateSession(mockDb, userId, campaignId, sessionId)
      ).rejects.toThrow(NotFoundError);
    });

    it('should throw NotFoundError if session belongs to different campaign', async () => {
      mockDb.oneOrNone.mockResolvedValue({ campaign_id: 'other-campaign', status: 'draft' });

      await expect(
        activateSession(mockDb, userId, campaignId, sessionId)
      ).rejects.toThrow(NotFoundError);
    });

    it('should transition status to in-progress if draft or planned', async () => {
      const mockSession = { campaign_id: campaignId, status: 'draft' };
      mockDb.oneOrNone.mockResolvedValue(mockSession);
      mockDb.tx.mockImplementation(async (callback: any) => {
        const mockT = {
          none: jest.fn(),
          one: jest.fn().mockResolvedValue({
            id: sessionId,
            status: 'in-progress',
            is_active: true,
            started_at: new Date(),
          }),
        };
        return callback(mockT);
      });

      await activateSession(mockDb, userId, campaignId, sessionId);

      // Verify transaction was called
      expect(mockDb.tx).toHaveBeenCalled();
    });
  });

  describe('deactivateSession', () => {
    it('should deactivate a session successfully', async () => {
      const mockSession = { id: sessionId, campaign_id: campaignId, is_active: false };

      mockDb.oneOrNone.mockResolvedValueOnce({ campaign_id: campaignId }); // verify session exists
      mockDb.one.mockResolvedValueOnce(mockSession);

      const result = await deactivateSession(mockDb, userId, campaignId, sessionId);

      expect(result).toEqual(mockSession);
      expect(campaignService.verifyCampaignOwnership).toHaveBeenCalledWith(
        mockDb,
        userId,
        campaignId
      );
      expect(mockDb.one).toHaveBeenCalledWith(
        'UPDATE sessions SET is_active = false WHERE id = $1 RETURNING *',
        [sessionId]
      );
    });

    it('should throw NotFoundError if session does not exist', async () => {
      mockDb.oneOrNone.mockResolvedValueOnce(null); // session not found

      await expect(
        deactivateSession(mockDb, userId, campaignId, 'session-999')
      ).rejects.toThrow(NotFoundError);
    });

    it('should throw NotFoundError if session belongs to different campaign', async () => {
      const differentCampaignId = 'different-campaign';

      mockDb.oneOrNone.mockResolvedValueOnce({ campaign_id: differentCampaignId });

      await expect(
        deactivateSession(mockDb, userId, campaignId, sessionId)
      ).rejects.toThrow(NotFoundError);
    });
  });
});
