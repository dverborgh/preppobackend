/**
 * Application configuration module
 * Loads and validates environment variables
 */

import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../../.env') });

/**
 * Configuration object with typed environment variables
 */
export const config = {
  // Server configuration
  server: {
    nodeEnv: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '8000', 10),
    apiBaseUrl: process.env.API_BASE_URL || '/api',
  },

  // Database configuration
  database: {
    host: process.env.DATABASE_HOST || 'localhost',
    port: parseInt(process.env.DATABASE_PORT || '5432', 10),
    name: process.env.DATABASE_NAME || 'preppo_db',
    user: process.env.DATABASE_USER || 'preppo_user',
    password: process.env.DATABASE_PASSWORD || '',
    poolSize: parseInt(process.env.DATABASE_POOL_SIZE || '30', 10),
  },

  // Redis configuration
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB || '0', 10),
  },

  // JWT configuration
  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret-change-in-production',
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
    issuer: process.env.JWT_ISSUER || 'preppo.example.com',
  },

  // OpenAI configuration
  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    orgId: process.env.OPENAI_ORG_ID || '',
    serviceTier: (process.env.OPENAI_SERVICE_TIER || 'default') as 'auto' | 'default' | 'priority' | 'flex' | 'scale',
    models: {
      ragQA: 'gpt-4-turbo-preview', // GPT-5 mini when available
      generatorDesign: 'gpt-4o-mini', // Cost-optimized model for generator design
      musicRecipe: 'gpt-4o-mini', // Cost-optimized model for music recipe design (~70% savings)
      embedding: 'text-embedding-3-small',
    },
  },

  // S3/Object storage configuration
  s3: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    region: process.env.AWS_REGION || 'us-east-1',
    bucketName: process.env.S3_BUCKET_NAME || 'preppo-data',
    endpoint: process.env.S3_ENDPOINT || undefined,
  },

  // Music provider configuration (Suno API)
  music: {
    sunoApiKey: process.env.SUNO_API_KEY || '',
    sunoBaseUrl: process.env.SUNO_API_BASE_URL || 'https://api.suno.ai',
  },

  // Rate limiting
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
    auth: {
      windowMs: 60000, // 1 minute
      maxRequests: 5, // 5 requests per minute
    },
    generatorRolls: {
      windowMs: 60000,
      maxRequests: 100,
    },
    ragQueries: {
      windowMs: 60000,
      maxRequests: 20,
    },
    uploads: {
      windowMs: 3600000, // 1 hour
      maxRequests: 10,
    },
    orchestrator: {
      windowMs: 3600000, // 1 hour
      maxRequests: parseInt(process.env.ORCHESTRATOR_RATE_LIMIT_PER_USER || '10', 10), // 10 per hour
    },
  },

  // File upload configuration
  upload: {
    maxFileSizeMB: parseInt(process.env.MAX_FILE_SIZE_MB || '500', 10),
    maxUploadPerCampaignPerDay: parseInt(
      process.env.MAX_UPLOAD_PER_CAMPAIGN_PER_DAY || '500',
      10
    ),
    allowedMimeTypes: ['application/pdf', 'text/plain'],
  },

  // Logging configuration
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    filePath: process.env.LOG_FILE_PATH || './logs/app.log',
  },

  // Performance configuration
  performance: {
    generatorRollTimeoutMs: parseInt(process.env.GENERATOR_ROLL_TIMEOUT_MS || '300', 10),
    ragQATimeoutMs: parseInt(process.env.RAG_QA_TIMEOUT_MS || '2000', 10),
  },

  // Feature flags
  features: {
    enablePromptCaching: process.env.ENABLE_PROMPT_CACHING === 'true',
    enableMusicGeneration: process.env.ENABLE_MUSIC_GENERATION === 'true',
    enableSessionPackets: process.env.ENABLE_SESSION_PACKETS === 'true',
    enableOrchestrator: process.env.ENABLE_ORCHESTRATOR !== 'false', // Default enabled
  },
};

/**
 * Validate required configuration
 */
export function validateConfig(): void {
  const requiredEnvVars = ['JWT_SECRET', 'DATABASE_PASSWORD'];

  const missing = requiredEnvVars.filter((key) => !process.env[key]);

  if (missing.length > 0 && config.server.nodeEnv === 'production') {
    throw new Error(
      `Missing required environment variables in production: ${missing.join(', ')}`
    );
  }

  // Warn about missing OpenAI key
  if (!config.openai.apiKey) {
    console.warn('WARNING: OPENAI_API_KEY not set. LLM features will not work.');
  }

  // Warn about missing S3 credentials
  if (!config.s3.accessKeyId || !config.s3.secretAccessKey) {
    console.warn('WARNING: S3 credentials not set. File uploads will not work.');
  }
}

/**
 * Get database connection string
 */
export function getDatabaseUrl(): string {
  const { host, port, name, user, password } = config.database;
  return `postgresql://${user}:${password}@${host}:${port}/${name}`;
}

/**
 * Get Redis connection string
 */
export function getRedisUrl(): string {
  const { host, port, password, db } = config.redis;
  if (password) {
    return `redis://:${password}@${host}:${port}/${db}`;
  }
  return `redis://${host}:${port}/${db}`;
}

export default config;
