/**
 * Winston logger configuration
 * Provides structured logging for the application
 */

import winston from 'winston';
import path from 'path';
import fs from 'fs';
import config from '../config';

// Ensure logs directory exists
const logsDir = path.dirname(config.logging.filePath);
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Define log format
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

// Console format for development
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let msg = `${timestamp} [${level}]: ${message}`;
    if (Object.keys(meta).length > 0) {
      msg += ` ${JSON.stringify(meta)}`;
    }
    return msg;
  })
);

// Create logger instance
const logger = winston.createLogger({
  level: config.logging.level,
  format: logFormat,
  defaultMeta: { service: 'preppo-backend' },
  transports: [
    // File transport for all logs
    new winston.transports.File({
      filename: config.logging.filePath,
      maxsize: 10485760, // 10MB
      maxFiles: 5,
    }),
    // Separate file for errors
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      maxsize: 10485760,
      maxFiles: 5,
    }),
  ],
});

// Add console transport in development
if (config.server.nodeEnv !== 'production') {
  logger.add(
    new winston.transports.Console({
      format: consoleFormat,
    })
  );
}

/**
 * Log LLM API call
 */
export function logLLMCall(data: {
  model: string;
  prompt: string;
  tokens?: number;
  cost?: number;
  latency?: number;
  error?: string;
}): void {
  logger.info('LLM API Call', {
    type: 'llm_call',
    ...data,
  });
}

/**
 * Log generator roll
 */
export function logGeneratorRoll(data: {
  generator_id: string;
  session_id: string;
  result: any;
  latency: number;
}): void {
  logger.info('Generator Roll', {
    type: 'generator_roll',
    ...data,
  });

  // Warn if latency exceeds target
  if (data.latency > 50) {
    logger.warn(`Generator roll exceeded 50ms target: ${data.latency}ms`, {
      generator_id: data.generator_id,
    });
  }
}

/**
 * Log RAG query
 */
export function logRAGQuery(data: {
  question: string;
  chunks_retrieved: number;
  answer_length: number;
  confidence?: number;
  latency: number;
}): void {
  logger.info('RAG Query', {
    type: 'rag_query',
    ...data,
  });

  // Warn if latency exceeds target
  if (data.latency > 2000) {
    logger.warn(`RAG query exceeded 2s target: ${data.latency}ms`);
  }
}

/**
 * Log API request
 */
export function logAPIRequest(data: {
  method: string;
  path: string;
  user_id?: string;
  status_code: number;
  latency: number;
  error?: string;
}): void {
  const level = data.status_code >= 500 ? 'error' : data.status_code >= 400 ? 'warn' : 'info';

  logger.log(level, 'API Request', {
    type: 'api_request',
    ...data,
  });
}

/**
 * Log security event
 */
export function logSecurityEvent(data: {
  event: string;
  user_id?: string;
  ip?: string;
  details?: any;
}): void {
  logger.warn('Security Event', {
    type: 'security_event',
    ...data,
  });
}

/**
 * Log performance metric
 */
export function logPerformance(data: {
  operation: string;
  duration_ms: number;
  metadata?: any;
}): void {
  logger.debug('Performance Metric', {
    type: 'performance',
    ...data,
  });
}

export default logger;
