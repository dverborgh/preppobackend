/**
 * Main application entry point
 * Initializes Express server, database, Redis, and routes
 */

import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import config, { validateConfig } from './config';
import { initDatabase, closeDatabase } from './config/database';
import { initRedis, closeRedis } from './config/redis';
import { initializeJobQueue, stopJobQueue } from './config/jobQueue';
import { registerResourceProcessor } from './workers/resourceProcessor';
import { registerTrackGenerationWorker } from './workers/trackGenerationWorker';
import * as embeddingService from './services/embeddingService';
import logger from './utils/logger';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { apiRateLimiter } from './middleware/rateLimiter';

// Import routes
import authRoutes from './routes/auth';
import campaignRoutes from './routes/campaigns';
import sessionRoutes from './routes/sessions';
import generatorRoutes from './routes/generators';
import resourceRoutes from './routes/resources';
import ragRoutes from './routes/rag';
import musicRoutes from './routes/music';
import soundboardRoutes from './routes/soundboard';

/**
 * Create and configure Express application
 */
function createApp(): Application {
  const app = express();

  // Security middleware
  app.use(helmet());
  app.use(cors({
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true,
  }));

  // Body parsing middleware
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Compression middleware (disable for SSE endpoints)
  app.use(compression({
    filter: (req, res) => {
      // Don't compress SSE streams
      if (res.getHeader('Content-Type') === 'text/event-stream') {
        return false;
      }
      // Use compression's default filter for everything else
      return compression.filter(req, res);
    }
  }));

  // Rate limiting
  app.use(apiRateLimiter);

  // Health check endpoint
  app.get('/health', async (_req, res) => {
    res.json({
      status: 'healthy',
      services: {
        database: 'healthy',
        redis: 'healthy',
      },
      uptime_seconds: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  });

  // API routes
  const apiRouter = express.Router();

  apiRouter.use('/auth', authRoutes);
  apiRouter.use('/campaigns', campaignRoutes);
  apiRouter.use('/sessions', sessionRoutes);
  apiRouter.use('/', generatorRoutes); // Generator routes handle both /campaigns/:id/generators and /generators/:id
  apiRouter.use('/', resourceRoutes); // Resource routes handle both /campaigns/:id/resources and /resources/:id
  apiRouter.use('/', ragRoutes); // RAG routes handle their own /campaigns/:id/rag/* paths
  apiRouter.use('/music', musicRoutes);
  apiRouter.use('/soundboard', soundboardRoutes);

  app.use(config.server.apiBaseUrl, apiRouter);

  // Error handlers (must be last)
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

/**
 * Start the server
 */
async function startServer(): Promise<void> {
  try {
    // Validate configuration
    validateConfig();

    // Initialize database
    await initDatabase();
    logger.info('Database initialized');

    // Validate OpenAI configuration
    embeddingService.validateConfiguration();
    logger.info('OpenAI embedding service validated');

    // Initialize Redis
    await initRedis();
    logger.info('Redis initialized');

    // Initialize job queue
    await initializeJobQueue();
    logger.info('Job queue initialized');

    // Register background workers
    await registerResourceProcessor();
    await registerTrackGenerationWorker();
    logger.info('Background workers registered');

    // Create Express app
    const app = createApp();

    // Start server
    const port = config.server.port;
    const server = app.listen(port, () => {
      logger.info(`Server started on port ${port} in ${config.server.nodeEnv} mode`);
      logger.info(`API available at http://localhost:${port}${config.server.apiBaseUrl}`);
    });

    // Graceful shutdown
    const shutdown = async (): Promise<void> => {
      logger.info('Shutting down server...');

      server.close(async () => {
        // Stop job queue (waits for active jobs)
        await stopJobQueue();
        logger.info('Job queue stopped');

        // Close database and Redis
        await closeDatabase();
        await closeRedis();
        logger.info('Server shut down successfully');
        process.exit(0);
      });

      // Force shutdown after 30 seconds (increased to allow jobs to finish)
      setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
      }, 30000);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Start server if run directly
if (require.main === module) {
  startServer();
}

export { createApp, startServer };
