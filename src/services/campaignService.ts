/**
 * Campaign service
 * Handles campaign CRUD operations with authorization and validation
 */

import { ExtendedDatabase } from '../config/database';
import {
  ConflictError,
  NotFoundError,
  ForbiddenError,
  ValidationError,
  PaginatedResponse,
} from '../types';
import logger from '../utils/logger';

// Campaign data types
export interface CreateCampaignData {
  name: string;
  system_name: string;
  description?: string;
  metadata?: Record<string, any>;
}

export interface UpdateCampaignData {
  name?: string;
  system_name?: string;
  description?: string;
  metadata?: Record<string, any>;
}

export interface CampaignResponse {
  id: string;
  user_id: string;
  name: string;
  system_name: string;
  description: string | null;
  created_at: Date;
  updated_at: Date;
  metadata: Record<string, any>;
}

export interface CampaignWithCounts extends CampaignResponse {
  session_count: number;
  resource_count: number;
  generator_count: number;
}

export interface CampaignListItem {
  id: string;
  name: string;
  system_name: string;
  created_at: Date;
  updated_at: Date;
  session_count: number;
  resource_count: number;
}

export interface ListCampaignsParams {
  skip?: number;
  limit?: number;
  sort?: 'created_at' | 'name' | 'updated_at';
  order?: 'asc' | 'desc';
}

/**
 * Create a new campaign
 * Validates uniqueness of campaign name per user
 */
export async function createCampaign(
  db: ExtendedDatabase,
  userId: string,
  data: CreateCampaignData
): Promise<CampaignResponse> {
  try {
    const campaign = await db.one<CampaignResponse>(
      `INSERT INTO campaigns (user_id, name, system_name, description, metadata)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, user_id, name, system_name, description, created_at, updated_at, metadata`,
      [
        userId,
        data.name.trim(),
        data.system_name.trim(),
        data.description?.trim() || null,
        data.metadata || {},
      ]
    );

    logger.info('Campaign created', {
      campaign_id: campaign.id,
      user_id: userId,
      name: campaign.name,
    });

    return campaign;
  } catch (error: any) {
    // Handle unique constraint violation
    if (error.code === '23505' && error.constraint === 'unique_campaign_name_per_user') {
      throw new ConflictError(`Campaign with name "${data.name}" already exists`);
    }
    throw error;
  }
}

/**
 * List campaigns for a user with pagination and sorting
 * Returns campaigns with aggregated session and resource counts
 */
export async function getCampaigns(
  db: ExtendedDatabase,
  userId: string,
  params: ListCampaignsParams = {}
): Promise<PaginatedResponse<CampaignListItem>> {
  const skip = Math.max(0, params.skip || 0);
  const limit = Math.min(100, Math.max(1, params.limit || 20));
  const sort = params.sort || 'created_at';
  const order = params.order || 'desc';

  // Validate sort field
  const validSortFields = ['created_at', 'name', 'updated_at'];
  if (!validSortFields.includes(sort)) {
    throw new ValidationError(`Invalid sort field: ${sort}`);
  }

  // Validate order
  if (order !== 'asc' && order !== 'desc') {
    throw new ValidationError(`Invalid order: ${order}`);
  }

  // Get total count
  const totalResult = await db.one<{ count: string }>(
    'SELECT COUNT(*) FROM campaigns WHERE user_id = $1',
    [userId]
  );
  const total = parseInt(totalResult.count, 10);

  // Get campaigns with aggregated counts
  // Note: Using safe column reference for ORDER BY
  const orderByColumn = sort === 'name' ? 'c.name' : sort === 'updated_at' ? 'c.updated_at' : 'c.created_at';

  const campaigns = await db.any<CampaignListItem>(
    `SELECT
      c.id,
      c.name,
      c.system_name,
      c.created_at,
      c.updated_at,
      COUNT(DISTINCT s.id)::int as session_count,
      COUNT(DISTINCT r.id)::int as resource_count
     FROM campaigns c
     LEFT JOIN sessions s ON s.campaign_id = c.id
     LEFT JOIN resources r ON r.campaign_id = c.id
     WHERE c.user_id = $1
     GROUP BY c.id, c.name, c.system_name, c.created_at, c.updated_at
     ORDER BY ${orderByColumn} ${order}
     LIMIT $2 OFFSET $3`,
    [userId, limit, skip]
  );

  logger.debug('Campaigns listed', {
    user_id: userId,
    count: campaigns.length,
    total,
  });

  return {
    data: campaigns,
    total,
    skip,
    limit,
  };
}

/**
 * Get campaign by ID with aggregated counts
 * Verifies user ownership before returning data
 */
export async function getCampaignById(
  db: ExtendedDatabase,
  userId: string,
  campaignId: string
): Promise<CampaignWithCounts> {
  const campaign = await db.oneOrNone<CampaignWithCounts>(
    `SELECT
      c.*,
      COUNT(DISTINCT s.id)::int as session_count,
      COUNT(DISTINCT r.id)::int as resource_count,
      COUNT(DISTINCT g.id)::int as generator_count
     FROM campaigns c
     LEFT JOIN sessions s ON s.campaign_id = c.id
     LEFT JOIN resources r ON r.campaign_id = c.id
     LEFT JOIN generators g ON g.campaign_id = c.id
     WHERE c.id = $1
     GROUP BY c.id`,
    [campaignId]
  );

  if (!campaign) {
    throw new NotFoundError('Campaign');
  }

  // Verify ownership
  if (campaign.user_id !== userId) {
    logger.warn('Campaign access denied', {
      campaign_id: campaignId,
      user_id: userId,
      owner_id: campaign.user_id,
    });
    throw new ForbiddenError('You do not have permission to access this campaign');
  }

  logger.debug('Campaign retrieved', {
    campaign_id: campaignId,
    user_id: userId,
  });

  return campaign;
}

/**
 * Update campaign
 * Verifies ownership and handles dynamic field updates
 */
export async function updateCampaign(
  db: ExtendedDatabase,
  userId: string,
  campaignId: string,
  data: UpdateCampaignData
): Promise<CampaignResponse> {
  // Verify ownership first
  await verifyCampaignOwnership(db, userId, campaignId);

  // Build dynamic update query
  const updates: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;

  if (data.name !== undefined) {
    updates.push(`name = $${paramIndex++}`);
    values.push(data.name.trim());
  }

  if (data.system_name !== undefined) {
    updates.push(`system_name = $${paramIndex++}`);
    values.push(data.system_name.trim());
  }

  if (data.description !== undefined) {
    updates.push(`description = $${paramIndex++}`);
    values.push(data.description?.trim() || null);
  }

  if (data.metadata !== undefined) {
    updates.push(`metadata = $${paramIndex++}`);
    values.push(data.metadata);
  }

  // If no updates, return current campaign
  if (updates.length === 0) {
    return getCampaignById(db, userId, campaignId);
  }

  // Add campaign_id to values
  values.push(campaignId);

  try {
    const campaign = await db.one<CampaignResponse>(
      `UPDATE campaigns
       SET ${updates.join(', ')}
       WHERE id = $${paramIndex}
       RETURNING id, user_id, name, system_name, description, created_at, updated_at, metadata`,
      values
    );

    logger.info('Campaign updated', {
      campaign_id: campaignId,
      user_id: userId,
      updates: Object.keys(data),
    });

    return campaign;
  } catch (error: any) {
    // Handle unique constraint violation
    if (error.code === '23505' && error.constraint === 'unique_campaign_name_per_user') {
      throw new ConflictError(`Campaign with name "${data.name}" already exists`);
    }
    throw error;
  }
}

/**
 * Delete campaign
 * Verifies ownership and cascade deletes all related data
 */
export async function deleteCampaign(
  db: ExtendedDatabase,
  userId: string,
  campaignId: string
): Promise<void> {
  // Verify ownership first
  await verifyCampaignOwnership(db, userId, campaignId);

  const result = await db.result(
    'DELETE FROM campaigns WHERE id = $1',
    [campaignId]
  );

  if (result.rowCount === 0) {
    throw new NotFoundError('Campaign');
  }

  logger.info('Campaign deleted', {
    campaign_id: campaignId,
    user_id: userId,
  });
}

/**
 * Verify campaign ownership
 * Utility function to check if user owns the campaign
 */
export async function verifyCampaignOwnership(
  db: ExtendedDatabase,
  userId: string,
  campaignId: string
): Promise<void> {
  const campaign = await db.oneOrNone<{ user_id: string }>(
    'SELECT user_id FROM campaigns WHERE id = $1',
    [campaignId]
  );

  if (!campaign) {
    throw new NotFoundError('Campaign');
  }

  if (campaign.user_id !== userId) {
    logger.warn('Campaign ownership verification failed', {
      campaign_id: campaignId,
      user_id: userId,
      owner_id: campaign.user_id,
    });
    throw new ForbiddenError('You do not have permission to access this campaign');
  }
}
