/**
 * Embedding Service
 * Generates embeddings for text chunks using OpenAI's text-embedding-3-small model
 * Handles batch processing, rate limiting, and cost tracking
 */

import OpenAI from 'openai';
import { getDatabase } from '../config/database';
import logger from '../utils/logger';
import pgvector from 'pgvector';

// Initialize OpenAI client
// Only include organization if it's set and not a placeholder
const openaiConfig: any = {
  apiKey: process.env.OPENAI_API_KEY,
};
const orgId = process.env.OPENAI_ORG_ID;
if (orgId && orgId !== 'your-org-id-here' && orgId.trim() !== '') {
  openaiConfig.organization = orgId;
}
const openai = new OpenAI(openaiConfig);

// Embedding model configuration
const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 1536;
const BATCH_SIZE = 100; // OpenAI allows up to 2048 inputs, but we use 100 for safety
const MAX_RETRIES = 5;
const COST_PER_MILLION_TOKENS = 0.02; // $0.02 per 1M tokens

/**
 * Sleep utility for retry backoff
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generate embeddings for multiple texts
 * Implements exponential backoff for rate limiting
 *
 * @param texts - Array of text strings to embed
 * @returns Array of embedding vectors (each is number[1536])
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }

  let retries = 0;

  while (retries <= MAX_RETRIES) {
    try {
      logger.debug('Calling OpenAI embeddings API', {
        model: EMBEDDING_MODEL,
        textCount: texts.length,
        attempt: retries + 1,
      });

      const response = await openai.embeddings.create({
        model: EMBEDDING_MODEL,
        input: texts,
        encoding_format: 'float',
      });

      // Sort by index to ensure correct order (API may return out of order)
      const embeddings = response.data
        .sort((a, b) => a.index - b.index)
        .map((d) => d.embedding);

      logger.debug('Embeddings generated successfully', {
        embeddingCount: embeddings.length,
        tokensUsed: response.usage.total_tokens,
      });

      return embeddings;
    } catch (error: any) {
      // Handle rate limiting errors with exponential backoff
      if (error.status === 429 && retries < MAX_RETRIES) {
        const waitTime = Math.pow(2, retries) * 1000; // 1s, 2s, 4s, 8s, 16s
        logger.warn('Rate limited by OpenAI, retrying after backoff', {
          retries,
          waitTimeMs: waitTime,
          error: error.message,
        });
        await sleep(waitTime);
        retries++;
      } else {
        // Non-retryable error or max retries exceeded
        logger.error('Failed to generate embeddings', {
          error: error.message,
          status: error.status,
          retries,
          textCount: texts.length,
        });
        throw new Error(`Failed to generate embeddings: ${error.message}`);
      }
    }
  }

  throw new Error('Max retries exceeded for embedding API');
}

/**
 * Generate embedding for a single query text
 * Convenience wrapper around embedTexts for single queries
 *
 * @param query - Text string to embed
 * @returns Embedding vector (number[1536])
 */
export async function embedQuery(query: string): Promise<number[]> {
  const embeddings = await embedTexts([query]);
  return embeddings[0];
}

/**
 * Generate embeddings for all chunks of a resource and store in database
 * Processes in batches to handle large resources efficiently
 *
 * @param resourceId - UUID of the resource
 * @param chunks - Array of chunk objects with id and raw_text
 * @returns Total tokens used and estimated cost
 */
export async function embedChunks(
  resourceId: string,
  chunks: Array<{ id: string; raw_text: string }>
): Promise<{ tokensUsed: number; estimatedCost: number }> {
  const db = getDatabase();
  let totalTokensUsed = 0;

  logger.info('Starting chunk embedding generation', {
    resourceId,
    totalChunks: chunks.length,
    batchSize: BATCH_SIZE,
  });

  const startTime = Date.now();

  // Process chunks in batches
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(chunks.length / BATCH_SIZE);

    logger.debug('Processing embedding batch', {
      resourceId,
      batchNumber,
      totalBatches,
      batchSize: batch.length,
    });

    try {
      // Extract content for embedding (database column is 'raw_text')
      const texts = batch.map((c) => c.raw_text);

      // Generate embeddings
      const embeddings = await embedTexts(texts);

      // Estimate tokens used (roughly 1 token per 4 characters)
      const batchTokens = texts.reduce((sum, text) => sum + Math.ceil(text.length / 4), 0);
      totalTokensUsed += batchTokens;

      // Update database with embeddings in a transaction for consistency
      await db.tx(async (t) => {
        for (let j = 0; j < batch.length; j++) {
          const chunkId = batch[j].id;
          const embedding = embeddings[j];

          // Convert embedding to pgvector format
          const embeddingVector = pgvector.toSql(embedding);

          await t.none(
            'UPDATE resource_chunks SET embedding = $1 WHERE id = $2',
            [embeddingVector, chunkId]
          );
        }
      });

      logger.debug('Batch embeddings stored successfully', {
        resourceId,
        batchNumber,
        chunkCount: batch.length,
        tokensUsed: batchTokens,
      });
    } catch (error: any) {
      logger.error('Failed to process embedding batch', {
        resourceId,
        batchNumber,
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  const duration = Date.now() - startTime;
  const estimatedCost = calculateEmbeddingCost(totalTokensUsed);

  logger.info('Chunk embedding generation completed', {
    resourceId,
    totalChunks: chunks.length,
    tokensUsed: totalTokensUsed,
    estimatedCost,
    durationMs: duration,
  });

  return {
    tokensUsed: totalTokensUsed,
    estimatedCost,
  };
}

/**
 * Calculate estimated cost for embedding generation
 * Based on OpenAI pricing: $0.02 per 1M tokens
 *
 * @param tokenCount - Number of tokens used
 * @returns Estimated cost in USD
 */
export function calculateEmbeddingCost(tokenCount: number): number {
  return (tokenCount / 1_000_000) * COST_PER_MILLION_TOKENS;
}

/**
 * Validate that OpenAI API key is configured
 * Should be called during service initialization
 */
export function validateConfiguration(): void {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY environment variable is not set');
  }

  logger.info('Embedding service configured', {
    model: EMBEDDING_MODEL,
    dimensions: EMBEDDING_DIMENSIONS,
    batchSize: BATCH_SIZE,
  });
}
