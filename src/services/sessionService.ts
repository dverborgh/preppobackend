/**
 * Session service
 * Handles session CRUD operations with authorization and validation
 */

import { ExtendedDatabase } from '../config/database';
import {
  NotFoundError,
  ValidationError,
  PaginatedResponse,
} from '../types';
import logger from '../utils/logger';
import { verifyCampaignOwnership } from './campaignService';

// Session data types
export interface CreateSessionData {
  session_number: number;
  name: string;
  scheduled_date?: string;
  description?: string;
  preparation_notes?: string;
  gm_objectives?: string[];
  notes?: string;
  duration_minutes?: number;
}

export interface UpdateSessionData {
  name?: string;
  session_number?: number;
  scheduled_date?: string | null;
  description?: string | null;
  notes?: string | null;
  duration_minutes?: number | null;
  status?: 'draft' | 'planned' | 'in-progress' | 'completed';
  preparation_notes?: string | null;
  gm_objectives?: string[];
}

export interface SessionResponse {
  id: string;
  campaign_id: string;
  session_number: number;
  name: string;
  scheduled_date: string | null;
  description: string | null;
  notes: string | null;
  duration_minutes: number | null;
  status: 'draft' | 'planned' | 'in-progress' | 'completed';
  created_at: Date;
  updated_at: Date;
  preparation_notes: string | null;
  gm_objectives: string[];
  is_active: boolean;
  started_at: Date | null;
}

export interface SessionWithCounts extends SessionResponse {
  scene_count: number;
  packet_count: number;
}

export interface SessionListItem {
  id: string;
  campaign_id: string;
  session_number: number;
  name: string;
  status: 'draft' | 'planned' | 'in-progress' | 'completed';
  scheduled_date: string | null;
  created_at: Date;
  updated_at: Date;
  scene_count: number;
  is_active: boolean;
}

export interface ListSessionsOptions {
  status?: 'draft' | 'planned' | 'in-progress' | 'completed';
  skip?: number;
  limit?: number;
}

/**
 * Valid status transitions map
 * Maps current status to allowed next statuses
 */
const VALID_STATUS_TRANSITIONS: Record<string, string[]> = {
  draft: ['planned', 'in-progress'],
  planned: ['in-progress', 'draft'],
  'in-progress': ['completed', 'planned'],
  completed: ['planned'],
};

/**
 * Helper function to validate status transitions
 */
function isValidStatusTransition(currentStatus: string, newStatus: string): boolean {
  if (currentStatus === newStatus) {
    return true; // Same status is always valid
  }
  const allowedTransitions = VALID_STATUS_TRANSITIONS[currentStatus];
  return allowedTransitions ? allowedTransitions.includes(newStatus) : false;
}

/**
 * Create a new session
 * Validates campaign ownership and initializes session with status='draft' and is_active=false
 */
export async function createSession(
  db: ExtendedDatabase,
  userId: string,
  campaignId: string,
  data: CreateSessionData
): Promise<SessionResponse> {
  // Verify campaign ownership first
  await verifyCampaignOwnership(db, userId, campaignId);

  // Validate session_number
  if (!Number.isInteger(data.session_number) || data.session_number < 1) {
    throw new ValidationError('Session number must be a positive integer');
  }

  // Validate name
  if (!data.name || data.name.trim().length === 0) {
    throw new ValidationError('Session name is required');
  }

  if (data.name.trim().length > 255) {
    throw new ValidationError('Session name must not exceed 255 characters');
  }

  // Validate duration_minutes if provided
  if (data.duration_minutes !== undefined && data.duration_minutes !== null) {
    if (!Number.isInteger(data.duration_minutes) || data.duration_minutes < 0) {
      throw new ValidationError('Duration minutes must be a non-negative integer');
    }
  }

  try {
    const session = await db.one<SessionResponse>(
      `INSERT INTO sessions (
        campaign_id, session_number, name, scheduled_date, description,
        preparation_notes, gm_objectives, notes, duration_minutes, status, is_active
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'draft', false)
      RETURNING *`,
      [
        campaignId,
        data.session_number,
        data.name.trim(),
        data.scheduled_date || null,
        data.description?.trim() || null,
        data.preparation_notes?.trim() || null,
        JSON.stringify(data.gm_objectives || []),
        data.notes?.trim() || null,
        data.duration_minutes || null,
      ]
    );

    logger.info('Session created', {
      session_id: session.id,
      campaign_id: campaignId,
      user_id: userId,
      session_number: session.session_number,
      name: session.name,
    });

    return session;
  } catch (error: any) {
    // Handle any database constraint violations
    if (error.code === '23505') {
      throw new ValidationError('A session with this number already exists in the campaign');
    }
    throw error;
  }
}

/**
 * List sessions for a campaign with optional filtering and pagination
 * Returns sessions
 */
export async function getSessions(
  db: ExtendedDatabase,
  userId: string,
  campaignId: string,
  options: ListSessionsOptions = {}
): Promise<PaginatedResponse<SessionListItem>> {
  // Verify campaign ownership first
  await verifyCampaignOwnership(db, userId, campaignId);

  const skip = Math.max(0, options.skip || 0);
  const limit = Math.min(100, Math.max(1, options.limit || 50));

  // Validate status filter if provided
  if (options.status) {
    const validStatuses = ['draft', 'planned', 'in-progress', 'completed'];
    if (!validStatuses.includes(options.status)) {
      throw new ValidationError(
        `Invalid status filter. Must be one of: ${validStatuses.join(', ')}`
      );
    }
  }

  // Build WHERE clause
  let whereClause = 's.campaign_id = $1';
  const params: any[] = [campaignId];

  if (options.status) {
    params.push(options.status);
    whereClause += ` AND s.status = $${params.length}`;
  }

  // Get total count
  const totalResult = await db.one<{ count: string }>(
    `SELECT COUNT(*) FROM sessions s WHERE ${whereClause}`,
    params
  );
  const total = parseInt(totalResult.count, 10);

  // Get sessions with aggregated scene counts
  const sessions = await db.any<SessionListItem>(
    `SELECT
      s.id,
      s.campaign_id,
      s.session_number,
      s.name,
      s.status,
      s.scheduled_date,
      s.created_at,
      s.updated_at,
      s.is_active
    FROM sessions s
    WHERE ${whereClause}
    ORDER BY s.session_number DESC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, skip]
  );

  logger.debug('Sessions listed', {
    campaign_id: campaignId,
    user_id: userId,
    count: sessions.length,
    total,
    status_filter: options.status,
  });

  return {
    data: sessions,
    total,
    skip,
    limit,
  };
}

/**
 * Get session by ID with aggregated counts
 * Verifies campaign ownership before returning data
 */
export async function getSessionById(
  db: ExtendedDatabase,
  userId: string,
  campaignId: string,
  sessionId: string
): Promise<SessionWithCounts> {
  // Verify campaign ownership first
  await verifyCampaignOwnership(db, userId, campaignId);

  const session = await db.oneOrNone<SessionWithCounts>(
    `SELECT
      s.* 
    FROM sessions s
    WHERE s.id = $1 AND s.campaign_id = $2`,
    [sessionId, campaignId]
  );

  if (!session) {
    throw new NotFoundError('Session');
  }

  logger.debug('Session retrieved', {
    session_id: sessionId,
    campaign_id: campaignId,
    user_id: userId,
  });

  return session;
}

/**
 * Update session
 * Verifies ownership and validates status transitions
 */
export async function updateSession(
  db: ExtendedDatabase,
  userId: string,
  campaignId: string,
  sessionId: string,
  data: UpdateSessionData
): Promise<SessionResponse> {
  // Verify campaign ownership first
  await verifyCampaignOwnership(db, userId, campaignId);

  // Get current session to validate status transition
  const currentSession = await db.oneOrNone<{ status: string; campaign_id: string }>(
    'SELECT status, campaign_id FROM sessions WHERE id = $1',
    [sessionId]
  );

  if (!currentSession) {
    throw new NotFoundError('Session');
  }

  // Verify session belongs to campaign
  if (currentSession.campaign_id !== campaignId) {
    throw new NotFoundError('Session');
  }

  // Validate status transition if status is being updated
  if (data.status && !isValidStatusTransition(currentSession.status, data.status)) {
    throw new ValidationError(
      `Invalid status transition from '${currentSession.status}' to '${data.status}'`
    );
  }

  // Validate fields
  if (data.name !== undefined) {
    if (!data.name || data.name.trim().length === 0) {
      throw new ValidationError('Session name cannot be empty');
    }
    if (data.name.trim().length > 255) {
      throw new ValidationError('Session name must not exceed 255 characters');
    }
  }

  if (data.session_number !== undefined) {
    if (!Number.isInteger(data.session_number) || data.session_number < 1) {
      throw new ValidationError('Session number must be a positive integer');
    }
  }

  if (data.duration_minutes !== undefined && data.duration_minutes !== null) {
    if (!Number.isInteger(data.duration_minutes) || data.duration_minutes < 0) {
      throw new ValidationError('Duration minutes must be a non-negative integer');
    }
  }

  // Build dynamic update query
  const updates: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;

  if (data.name !== undefined) {
    updates.push(`name = $${paramIndex++}`);
    values.push(data.name.trim());
  }

  if (data.session_number !== undefined) {
    updates.push(`session_number = $${paramIndex++}`);
    values.push(data.session_number);
  }

  if (data.scheduled_date !== undefined) {
    updates.push(`scheduled_date = $${paramIndex++}`);
    values.push(data.scheduled_date);
  }

  if (data.description !== undefined) {
    updates.push(`description = $${paramIndex++}`);
    values.push(data.description?.trim() || null);
  }

  if (data.notes !== undefined) {
    updates.push(`notes = $${paramIndex++}`);
    values.push(data.notes?.trim() || null);
  }

  if (data.duration_minutes !== undefined) {
    updates.push(`duration_minutes = $${paramIndex++}`);
    values.push(data.duration_minutes);
  }

  if (data.status !== undefined) {
    updates.push(`status = $${paramIndex++}`);
    values.push(data.status);
  }

  if (data.preparation_notes !== undefined) {
    updates.push(`preparation_notes = $${paramIndex++}`);
    values.push(data.preparation_notes?.trim() || null);
  }

  if (data.gm_objectives !== undefined) {
    updates.push(`gm_objectives = $${paramIndex++}`);
    values.push(JSON.stringify(data.gm_objectives));
  }

  // If no updates, return current session
  if (updates.length === 0) {
    return getSessionById(db, userId, campaignId, sessionId);
  }

  // Add session_id and campaign_id to values
  values.push(sessionId);
  values.push(campaignId);

  const session = await db.one<SessionResponse>(
    `UPDATE sessions
     SET ${updates.join(', ')}
     WHERE id = $${paramIndex++} AND campaign_id = $${paramIndex}
     RETURNING *`,
    values
  );

  logger.info('Session updated', {
    session_id: sessionId,
    campaign_id: campaignId,
    user_id: userId,
    updates: Object.keys(data),
  });

  return session;
}

/**
 * Delete session
 * Verifies ownership and cascade deletes all related data
 */
export async function deleteSession(
  db: ExtendedDatabase,
  userId: string,
  campaignId: string,
  sessionId: string
): Promise<void> {
  // Verify campaign ownership first
  await verifyCampaignOwnership(db, userId, campaignId);

  // Verify session exists and belongs to campaign
  const session = await db.oneOrNone<{ campaign_id: string }>(
    'SELECT campaign_id FROM sessions WHERE id = $1',
    [sessionId]
  );

  if (!session) {
    throw new NotFoundError('Session');
  }

  if (session.campaign_id !== campaignId) {
    throw new NotFoundError('Session');
  }

  const result = await db.result(
    'DELETE FROM sessions WHERE id = $1',
    [sessionId]
  );

  if (result.rowCount === 0) {
    throw new NotFoundError('Session');
  }

  logger.info('Session deleted', {
    session_id: sessionId,
    campaign_id: campaignId,
    user_id: userId,
  });
}

/**
 * Activate session for use in Session Console
 * Atomically deactivates all other sessions in campaign and activates target session
 * Sets started_at timestamp if null and transitions status to 'in-progress' if needed
 */
export async function activateSession(
  db: ExtendedDatabase,
  userId: string,
  campaignId: string,
  sessionId: string
): Promise<SessionResponse> {
  // Verify campaign ownership first
  await verifyCampaignOwnership(db, userId, campaignId);

  // Verify session exists and belongs to campaign
  const session = await db.oneOrNone<{ campaign_id: string; status: string }>(
    'SELECT campaign_id, status FROM sessions WHERE id = $1',
    [sessionId]
  );

  if (!session) {
    throw new NotFoundError('Session');
  }

  if (session.campaign_id !== campaignId) {
    throw new NotFoundError('Session');
  }

  // Use transaction to ensure atomicity
  const updatedSession = await db.tx(async (t) => {
    // Step 1: Deactivate all sessions in campaign
    await t.none(
      'UPDATE sessions SET is_active = false WHERE campaign_id = $1 AND is_active = true',
      [campaignId]
    );

    // Step 2: Activate target session
    const activated = await t.one<SessionResponse>(
      `UPDATE sessions
       SET
         is_active = true,
         started_at = COALESCE(started_at, CURRENT_TIMESTAMP),
         status = CASE
           WHEN status IN ('draft', 'planned') THEN 'in-progress'
           ELSE status
         END
       WHERE id = $1 AND campaign_id = $2
       RETURNING *`,
      [sessionId, campaignId]
    );

    return activated;
  });

  logger.info('Session activated', {
    session_id: sessionId,
    campaign_id: campaignId,
    user_id: userId,
    status: updatedSession.status,
    started_at: updatedSession.started_at,
  });

  return updatedSession;
}

/**
 * Deactivate session (remove from Session Console)
 * Sets is_active to false for the target session
 */
export async function deactivateSession(
  db: ExtendedDatabase,
  userId: string,
  campaignId: string,
  sessionId: string
): Promise<SessionResponse> {
  // Verify campaign ownership first
  await verifyCampaignOwnership(db, userId, campaignId);

  // Verify session exists and belongs to campaign
  const session = await db.oneOrNone<{ campaign_id: string }>(
    'SELECT campaign_id FROM sessions WHERE id = $1',
    [sessionId]
  );

  if (!session) {
    throw new NotFoundError('Session');
  }

  if (session.campaign_id !== campaignId) {
    throw new NotFoundError('Session');
  }

  // Deactivate the session
  const updated = await db.one<SessionResponse>(
    'UPDATE sessions SET is_active = false WHERE id = $1 RETURNING *',
    [sessionId]
  );

  logger.info('Session deactivated', {
    session_id: sessionId,
    campaign_id: campaignId,
    user_id: userId,
  });

  return updated;
}
