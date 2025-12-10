/**
 * Job Queue Configuration using pg-boss
 * Handles asynchronous background job processing for resource processing
 */

import PgBoss from 'pg-boss';
import logger from '../utils/logger';
import { getDatabaseUrl } from './index';

let boss: PgBoss | null = null;

/**
 * Initialize pg-boss job queue
 * Creates the necessary database schema in the 'pgboss' schema
 */
export async function initializeJobQueue(): Promise<PgBoss> {
  if (boss) {
    logger.info('Job queue already initialized');
    return boss;
  }

  try {
    const connectionString = getDatabaseUrl();

    boss = new PgBoss({
      connectionString,
      schema: 'pgboss',
      // Monitoring and maintenance options
      monitorStateIntervalSeconds: 60,
      maintenanceIntervalSeconds: 300,
      // Archive completed jobs after 7 days
      archiveCompletedAfterSeconds: 7 * 24 * 60 * 60,
      // Delete archived jobs after 30 days
      deleteAfterDays: 30,
      // Logging
      noSupervisor: false,
      noScheduling: false,
    });

    boss.on('error', (error) => {
      logger.error('pg-boss error', { error: error.message, stack: error.stack });
    });

    boss.on('monitor-states', (states) => {
      logger.debug('Job queue states', {
        created: states.created,
        retry: states.retry,
        active: states.active,
        completed: states.completed,
        expired: states.expired,
        cancelled: states.cancelled,
        failed: states.failed,
      });
    });

    await boss.start();

    logger.info('Job queue initialized successfully', {
      schema: 'pgboss',
    });

    return boss;
  } catch (error: any) {
    logger.error('Failed to initialize job queue', {
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

/**
 * Get the job queue instance
 * Throws error if not initialized
 */
export function getJobQueue(): PgBoss {
  if (!boss) {
    throw new Error('Job queue not initialized. Call initializeJobQueue() first.');
  }
  return boss;
}

/**
 * Stop the job queue gracefully
 * Waits for active jobs to complete
 */
export async function stopJobQueue(): Promise<void> {
  if (boss) {
    try {
      await boss.stop({ timeout: 30000 }); // Wait up to 30 seconds
      boss = null;
      logger.info('Job queue stopped gracefully');
    } catch (error: any) {
      logger.error('Error stopping job queue', {
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }
}

/**
 * Get queue statistics for monitoring
 */
export async function getQueueStats(): Promise<any> {
  const queue = getJobQueue();

  try {
    // Get queue status for different job types
    const stats = {
      processResource: await queue.getQueueSize('process-resource'),
      timestamp: new Date().toISOString(),
    };

    return stats;
  } catch (error: any) {
    logger.error('Error getting queue stats', { error: error.message });
    return null;
  }
}

/**
 * Health check for job queue
 */
export async function healthCheck(): Promise<boolean> {
  try {
    const queue = getJobQueue();
    // Try to get queue size as a simple health check
    await queue.getQueueSize('process-resource');
    return true;
  } catch (error) {
    logger.error('Job queue health check failed', { error });
    return false;
  }
}
