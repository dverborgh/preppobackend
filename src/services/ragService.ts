/**
 * RAG (Retrieval-Augmented Generation) Service
 * Implements vector search, hybrid search, and answer generation
 * Provides semantic search over campaign resource chunks with strict grounding
 */

import { ExtendedDatabase } from '../config/database';
import * as embeddingService from './embeddingService';
import { verifyCampaignOwnership } from './campaignService';
import logger from '../utils/logger';
import pgvector from 'pgvector';
import { llmService, ChatMessage } from './llmService';
import { v4 as uuidv4 } from 'uuid';

/**
 * Filters for resource search
 */
export interface SearchFilters {
  resourceIds?: string[];
  pageNumbers?: number[];
  tags?: string[];
}

/**
 * Scored chunk result with source information
 */
export interface ScoredChunk {
  chunkId: string;
  resourceId: string;
  content: string;
  pageNumber: number | null;
  sectionHeading: string | null;
  fileName: string;
  score: number;
  source: 'vector' | 'keyword' | 'hybrid';
}

/**
 * Options for RAG query
 */
export interface RAGQueryOptions {
  resourceIds?: string[];
  topK?: number; // Default 10
  conversationId?: string;
}

/**
 * RAG query response with answer and sources
 */
export interface RAGResponse {
  queryId: string;
  answer: string;
  sources: SourceChunk[];
  metadata: QueryMetadata;
}

/**
 * Source chunk in RAG response
 */
export interface SourceChunk {
  chunkId: string;
  resourceId: string;
  fileName: string;
  pageNumber: number | null;
  sectionHeading: string | null;
  contentPreview: string; // First 200 chars
  similarityScore: number;
  rank: number;
}

/**
 * Query metadata for performance tracking
 */
export interface QueryMetadata {
  model: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  searchLatencyMs: number;
  llmLatencyMs: number;
  chunksRetrieved: number;
  conversationId?: string;
}

/**
 * Conversation message for multi-turn conversations
 */
export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Perform vector similarity search on resource chunks
 * Uses cosine distance with pgvector HNSW index
 *
 * @param db - Database instance
 * @param campaignId - Campaign UUID to filter results
 * @param queryEmbedding - Query vector (1536 dimensions)
 * @param topK - Number of results to return
 * @param filters - Optional filters for resources, pages, or tags
 * @returns Array of scored chunks ordered by similarity
 */
export async function vectorSearch(
  db: ExtendedDatabase,
  campaignId: string,
  queryEmbedding: number[],
  topK: number = 10,
  filters?: SearchFilters
): Promise<ScoredChunk[]> {
  const startTime = Date.now();

  logger.debug('Performing vector search', {
    campaignId,
    topK,
    filters,
  });

  // Build WHERE clause with filters
  const conditions: string[] = [
    'r.campaign_id = $2',
    "r.ingestion_status = 'completed'",
    'rc.embedding IS NOT NULL',
  ];
  const params: any[] = [pgvector.toSql(queryEmbedding), campaignId];
  let paramIndex = 3;

  if (filters?.resourceIds && filters.resourceIds.length > 0) {
    conditions.push(`r.id = ANY($${paramIndex}::uuid[])`);
    params.push(filters.resourceIds);
    paramIndex++;
  }

  if (filters?.pageNumbers && filters.pageNumbers.length > 0) {
    conditions.push(`rc.page_number = ANY($${paramIndex}::int[])`);
    params.push(filters.pageNumbers);
    paramIndex++;
  }

  if (filters?.tags && filters.tags.length > 0) {
    conditions.push(`rc.tags && $${paramIndex}::text[]`);
    params.push(filters.tags);
    paramIndex++;
  }

  const whereClause = conditions.join(' AND ');

  // Vector search query using cosine distance operator (<=>)
  // Lower distance = higher similarity, so we convert to similarity score (1 - distance)
  const query = `
    SELECT
      rc.id AS chunk_id,
      rc.resource_id,
      rc.raw_text AS content,
      rc.page_number,
      rc.section_heading,
      r.original_filename AS file_name,
      1 - (rc.embedding <=> $1::vector) AS similarity_score
    FROM resource_chunks rc
    JOIN resources r ON rc.resource_id = r.id
    WHERE ${whereClause}
    ORDER BY rc.embedding <=> $1::vector
    LIMIT $${paramIndex}
  `;

  params.push(topK);

  try {
    const results = await db.any(query, params);

    const duration = Date.now() - startTime;

    logger.info('Vector search completed', {
      campaignId,
      resultCount: results.length,
      durationMs: duration,
    });

    return results.map((row) => ({
      chunkId: row.chunk_id,
      resourceId: row.resource_id,
      content: row.content,
      pageNumber: row.page_number,
      sectionHeading: row.section_heading,
      fileName: row.file_name,
      score: parseFloat(row.similarity_score),
      source: 'vector' as const,
    }));
  } catch (error: any) {
    logger.error('Vector search failed', {
      campaignId,
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

/**
 * Perform keyword-based full-text search on resource chunks
 * Uses PostgreSQL's GIN index on tsvector
 *
 * @param db - Database instance
 * @param campaignId - Campaign UUID to filter results
 * @param query - Search query string
 * @param topK - Number of results to return
 * @param filters - Optional filters for resources, pages, or tags
 * @returns Array of scored chunks ordered by relevance
 */
export async function keywordSearch(
  db: ExtendedDatabase,
  campaignId: string,
  query: string,
  topK: number = 10,
  filters?: SearchFilters
): Promise<ScoredChunk[]> {
  const startTime = Date.now();

  logger.debug('Performing keyword search', {
    campaignId,
    query,
    topK,
    filters,
  });

  // Build WHERE clause with filters
  const conditions: string[] = [
    'r.campaign_id = $2',
    "r.ingestion_status = 'completed'",
    "to_tsvector('english', rc.raw_text) @@ plainto_tsquery('english', $1)",
  ];
  const params: any[] = [query, campaignId];
  let paramIndex = 3;

  if (filters?.resourceIds && filters.resourceIds.length > 0) {
    conditions.push(`r.id = ANY($${paramIndex}::uuid[])`);
    params.push(filters.resourceIds);
    paramIndex++;
  }

  if (filters?.pageNumbers && filters.pageNumbers.length > 0) {
    conditions.push(`rc.page_number = ANY($${paramIndex}::int[])`);
    params.push(filters.pageNumbers);
    paramIndex++;
  }

  if (filters?.tags && filters.tags.length > 0) {
    conditions.push(`rc.tags && $${paramIndex}::text[]`);
    params.push(filters.tags);
    paramIndex++;
  }

  const whereClause = conditions.join(' AND ');

  // Keyword search query using ts_rank for relevance scoring
  const sqlQuery = `
    SELECT
      rc.id AS chunk_id,
      rc.resource_id,
      rc.raw_text AS content,
      rc.page_number,
      rc.section_heading,
      r.original_filename AS file_name,
      ts_rank(to_tsvector('english', rc.raw_text), plainto_tsquery('english', $1)) AS relevance_score
    FROM resource_chunks rc
    JOIN resources r ON rc.resource_id = r.id
    WHERE ${whereClause}
    ORDER BY relevance_score DESC
    LIMIT $${paramIndex}
  `;

  params.push(topK);

  try {
    const results = await db.any(sqlQuery, params);

    const duration = Date.now() - startTime;

    logger.info('Keyword search completed', {
      campaignId,
      query,
      resultCount: results.length,
      durationMs: duration,
    });

    return results.map((row) => ({
      chunkId: row.chunk_id,
      resourceId: row.resource_id,
      content: row.content,
      pageNumber: row.page_number,
      sectionHeading: row.section_heading,
      fileName: row.file_name,
      score: parseFloat(row.relevance_score),
      source: 'keyword' as const,
    }));
  } catch (error: any) {
    logger.error('Keyword search failed', {
      campaignId,
      query,
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

/**
 * Perform hybrid search using Reciprocal Rank Fusion (RRF)
 * Combines vector and keyword search results for better retrieval
 *
 * @param db - Database instance
 * @param campaignId - Campaign UUID to filter results
 * @param query - Search query string
 * @param topK - Number of results to return
 * @param filters - Optional filters for resources, pages, or tags
 * @param k - RRF constant (default 60, higher = less weight to rank position)
 * @returns Array of scored chunks ordered by fused rank
 */
export async function hybridSearch(
  db: ExtendedDatabase,
  campaignId: string,
  query: string,
  topK: number = 10,
  filters?: SearchFilters,
  k: number = 60
): Promise<ScoredChunk[]> {
  const startTime = Date.now();

  logger.debug('Performing hybrid search', {
    campaignId,
    query,
    topK,
    filters,
    k,
  });

  // Generate query embedding for vector search
  const queryEmbedding = await embeddingService.embedQuery(query);

  // Perform both searches in parallel
  const [vectorResults, keywordResults] = await Promise.all([
    vectorSearch(db, campaignId, queryEmbedding, topK * 2, filters), // Get more results for fusion
    keywordSearch(db, campaignId, query, topK * 2, filters),
  ]);

  // Apply Reciprocal Rank Fusion
  // RRF score = sum(1 / (k + rank_i)) for each list where document appears
  const fusedScores: Map<string, { chunk: ScoredChunk; score: number }> = new Map();

  // Process vector results
  vectorResults.forEach((chunk, index) => {
    const rank = index + 1;
    const rrfScore = 1 / (k + rank);

    if (fusedScores.has(chunk.chunkId)) {
      const existing = fusedScores.get(chunk.chunkId)!;
      existing.score += rrfScore;
    } else {
      fusedScores.set(chunk.chunkId, {
        chunk: { ...chunk, source: 'hybrid' },
        score: rrfScore,
      });
    }
  });

  // Process keyword results
  keywordResults.forEach((chunk, index) => {
    const rank = index + 1;
    const rrfScore = 1 / (k + rank);

    if (fusedScores.has(chunk.chunkId)) {
      const existing = fusedScores.get(chunk.chunkId)!;
      existing.score += rrfScore;
    } else {
      fusedScores.set(chunk.chunkId, {
        chunk: { ...chunk, source: 'hybrid' },
        score: rrfScore,
      });
    }
  });

  // Sort by fused score and take top K
  const sortedResults = Array.from(fusedScores.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(({ chunk, score }) => ({
      ...chunk,
      score, // RRF score
    }));

  const duration = Date.now() - startTime;

  logger.info('Hybrid search completed', {
    campaignId,
    query,
    vectorResultCount: vectorResults.length,
    keywordResultCount: keywordResults.length,
    fusedResultCount: sortedResults.length,
    durationMs: duration,
  });

  return sortedResults;
}

/**
 * Search chunks across campaign resources
 * Main entry point for RAG retrieval - uses hybrid search by default
 *
 * @param db - Database instance
 * @param userId - User ID for authorization
 * @param campaignId - Campaign UUID
 * @param query - Search query string
 * @param options - Search options (topK, resourceIds, search mode)
 * @returns Array of scored chunks with source information
 */
export async function searchChunks(
  db: ExtendedDatabase,
  userId: string,
  campaignId: string,
  query: string,
  options?: {
    topK?: number;
    resourceIds?: string[];
    mode?: 'vector' | 'keyword' | 'hybrid';
  }
): Promise<ScoredChunk[]> {
  // Verify user has access to campaign
  await verifyCampaignOwnership(db, userId, campaignId);

  const topK = options?.topK || 10;
  const mode = options?.mode || 'hybrid';
  const filters: SearchFilters = {
    resourceIds: options?.resourceIds,
  };

  logger.info('Searching chunks', {
    userId,
    campaignId,
    query: query.substring(0, 100), // Log first 100 chars only
    mode,
    topK,
    resourceFilters: filters.resourceIds?.length || 0,
  });

  let results: ScoredChunk[];

  switch (mode) {
    case 'vector': {
      const queryEmbedding = await embeddingService.embedQuery(query);
      results = await vectorSearch(db, campaignId, queryEmbedding, topK, filters);
      break;
    }
    case 'keyword': {
      results = await keywordSearch(db, campaignId, query, topK, filters);
      break;
    }
    case 'hybrid':
    default: {
      results = await hybridSearch(db, campaignId, query, topK, filters);
      break;
    }
  }

  logger.info('Chunk search completed', {
    userId,
    campaignId,
    mode,
    resultCount: results.length,
    topScore: results.length > 0 ? results[0].score.toFixed(4) : 'N/A',
  });

  return results;
}

/**
 * System prompt for RAG answer generation
 * Enforces strict grounding and citation requirements
 */
const SYSTEM_PROMPT = `You are a tabletop RPG rules and lore assistant for a Game Master.

Your role is to answer questions using ONLY the information provided in the excerpts below.
These excerpts come from the GM's campaign materials.

STRICT GROUNDING RULES:
1. Base your answer ONLY on the provided excerpts
2. If the answer is not in the excerpts, say "I don't have that information in the provided materials"
3. Suggest what the GM might decide or where else they could look
4. ALWAYS cite the source using [Page X, Section Name] format
5. If excerpts contradict, mention both with citations and note the discrepancy

DO NOT:
- Invent information not in the excerpts
- Use your general knowledge about RPGs
- Make assumptions beyond what's explicitly stated

FORMATTING:
- Use clear, concise language
- Organize answers with bullet points or numbered lists when appropriate
- Highlight key rules or important details
- Include page numbers for all factual claims`;

/**
 * Generate answer using LLM with strict grounding
 * Uses GPT-4 (or GPT-4-turbo) for high-quality, grounded responses
 *
 * @param query - User's question
 * @param chunks - Retrieved relevant chunks
 * @param conversationHistory - Optional conversation history for multi-turn
 * @returns Answer text and token usage
 */
export async function generateAnswer(
  query: string,
  chunks: ScoredChunk[],
  conversationHistory?: ConversationMessage[]
): Promise<{ answer: string; promptTokens: number; completionTokens: number }> {
  const startTime = Date.now();

  logger.debug('Generating answer', {
    query: query.substring(0, 100),
    chunkCount: chunks.length,
    hasConversationHistory: !!conversationHistory,
  });

  // Format chunks for context with citations
  const formattedChunks = chunks
    .map((chunk, i) => {
      const pageInfo = chunk.pageNumber ? `Page ${chunk.pageNumber}` : 'Unknown Page';
      const sectionInfo = chunk.sectionHeading || 'Untitled';

      return `[Excerpt ${i + 1}]
Page: ${pageInfo}
Section: ${sectionInfo}
Content: ${chunk.content}
---`;
    })
    .join('\n');

  // Build user prompt with query and excerpts
  const userPrompt = `QUESTION: ${query}

RELEVANT EXCERPTS:
${formattedChunks}

Please answer the question based strictly on the excerpts above.`;

  // Build messages array with system prompt
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
  ];

  // Add conversation history if provided (last 2 turns = 4 messages)
  if (conversationHistory && conversationHistory.length > 0) {
    const recentHistory = conversationHistory.slice(-4);
    messages.push(...(recentHistory as ChatMessage[]));
  }

  // Add current query
  messages.push({ role: 'user', content: userPrompt });

  try {
    // Call LLM service with appropriate model for RAG Q&A
    const response = await llmService.complete(
      messages,
      llmService.getModel('ragQA'),
      {
        temperature: 0.3,
        maxTokens: 1000,
      }
    );

    const duration = Date.now() - startTime;

    logger.info('Answer generated successfully', {
      query: query.substring(0, 100),
      answerLength: response.content.length,
      promptTokens: response.promptTokens,
      completionTokens: response.completionTokens,
      durationMs: duration,
      model: response.model,
    });

    return {
      answer: response.content,
      promptTokens: response.promptTokens,
      completionTokens: response.completionTokens,
    };
  } catch (error: any) {
    logger.error('Answer generation failed', {
      query: query.substring(0, 100),
      error: error.message,
      stack: error.stack,
    });
    throw new Error(`Failed to generate answer: ${error.message}`);
  }
}

/**
 * Streaming event types for RAG query responses
 */
export type StreamEvent =
  | { type: 'chunk'; content: string }
  | { type: 'sources'; sources: SourceChunk[] }
  | { type: 'done'; metadata: QueryMetadata; queryId: string };

/**
 * Generate answer using LLM with streaming (SSE)
 * Streams tokens as they arrive for better perceived latency
 *
 * @param query - User's question
 * @param chunks - Retrieved relevant chunks
 * @param conversationHistory - Optional conversation history for multi-turn
 * @yields Streaming events (chunks, sources, metadata)
 */
export async function* generateAnswerStream(
  query: string,
  chunks: ScoredChunk[],
  conversationHistory?: ConversationMessage[]
): AsyncGenerator<StreamEvent, void, unknown> {
  const startTime = Date.now();

  logger.debug('Generating streaming answer', {
    query: query.substring(0, 100),
    chunkCount: chunks.length,
    hasConversationHistory: !!conversationHistory,
  });

  // Format chunks for context with citations
  const formattedChunks = chunks
    .map((chunk, i) => {
      const pageInfo = chunk.pageNumber ? `Page ${chunk.pageNumber}` : 'Unknown Page';
      const sectionInfo = chunk.sectionHeading || 'Untitled';

      return `[Excerpt ${i + 1}]
Page: ${pageInfo}
Section: ${sectionInfo}
Content: ${chunk.content}
---`;
    })
    .join('\n');

  // Build user prompt with query and excerpts
  const userPrompt = `QUESTION: ${query}

RELEVANT EXCERPTS:
${formattedChunks}

Please answer the question based strictly on the excerpts above.`;

  // Build messages array with system prompt
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
  ];

  // Add conversation history if provided (last 2 turns = 4 messages)
  if (conversationHistory && conversationHistory.length > 0) {
    const recentHistory = conversationHistory.slice(-4);
    messages.push(...(recentHistory as ChatMessage[]));
  }

  // Add current query
  messages.push({ role: 'user', content: userPrompt });

  try {
    // Call LLM service with streaming enabled
    const stream = llmService.streamComplete(
      messages,
      llmService.getModel('ragQA'),
      {
        temperature: 0.3,
        maxTokens: 1000,
      }
    );

    let fullAnswer = '';
    let promptTokens = 0;
    let completionTokens = 0;
    let model = '';

    // Stream tokens as they arrive
    for await (const chunk of stream) {
      // Check if this is a final metadata chunk or content chunk
      if ('latencyMs' in chunk) {
        // This is the final metadata chunk (CompletionResponse)
        fullAnswer = chunk.content;
        promptTokens = chunk.promptTokens;
        completionTokens = chunk.completionTokens;
        model = chunk.model;
      } else {
        // This is a streaming content chunk (StreamChunk)
        yield {
          type: 'chunk',
          content: chunk.content,
        };
      }
    }

    const duration = Date.now() - startTime;

    logger.info('Streaming answer completed', {
      query: query.substring(0, 100),
      answerLength: fullAnswer.length,
      promptTokens,
      completionTokens,
      durationMs: duration,
      model,
    });

    // Yield sources
    const sources: SourceChunk[] = chunks.map((chunk, i) => ({
      chunkId: chunk.chunkId,
      resourceId: chunk.resourceId,
      fileName: chunk.fileName,
      pageNumber: chunk.pageNumber,
      sectionHeading: chunk.sectionHeading,
      contentPreview: chunk.content.substring(0, 200),
      similarityScore: chunk.score,
      rank: i + 1,
    }));

    yield {
      type: 'sources',
      sources,
    };

    // Yield final metadata
    yield {
      type: 'done',
      metadata: {
        model: 'gpt-4o-mini',
        promptTokens,
        completionTokens,
        latencyMs: duration,
        searchLatencyMs: 0, // Will be set by caller
        llmLatencyMs: duration,
        chunksRetrieved: chunks.length,
      },
      queryId: '', // Will be set after logging
    };

  } catch (error: any) {
    logger.error('Streaming answer generation failed', {
      query: query.substring(0, 100),
      error: error.message,
      stack: error.stack,
    });
    throw new Error(`Failed to generate streaming answer: ${error.message}`);
  }
}

/**
 * Log RAG query to database for evaluation and debugging
 *
 * @param db - Database instance
 * @param data - Query data to log
 * @returns Query ID
 */
export async function logQuery(
  db: ExtendedDatabase,
  data: {
    campaignId: string;
    userId: string;
    query: string;
    retrievedChunkIds: string[];
    retrievedChunkScores: number[];
    answer: string;
    model: string;
    promptTokens: number;
    completionTokens: number;
    latencyMs: number;
    conversationId?: string;
  }
): Promise<string> {
  logger.debug('Logging RAG query', {
    campaignId: data.campaignId,
    userId: data.userId,
    chunkCount: data.retrievedChunkIds.length,
  });

  try {
    const result = await db.one(
      `INSERT INTO rag_queries (
        campaign_id, user_id, query_text, retrieved_chunk_ids,
        retrieved_chunk_scores, llm_response, llm_model,
        prompt_tokens, completion_tokens, latency_ms, conversation_id
      ) VALUES ($1, $2, $3, $4::uuid[], $5, $6, $7, $8, $9, $10, $11)
      RETURNING id`,
      [
        data.campaignId,
        data.userId,
        data.query,
        data.retrievedChunkIds,
        data.retrievedChunkScores,
        data.answer,
        data.model,
        data.promptTokens,
        data.completionTokens,
        data.latencyMs,
        data.conversationId || null,
      ]
    );

    logger.info('RAG query logged', {
      queryId: result.id,
      campaignId: data.campaignId,
    });

    return result.id;
  } catch (error: any) {
    logger.error('Failed to log RAG query', {
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

/**
 * Query campaign resources using RAG
 * Main entry point for RAG Q&A with LLM answer generation
 *
 * @param db - Database instance
 * @param userId - User ID for authorization
 * @param campaignId - Campaign UUID
 * @param query - User's question
 * @param options - Query options (resourceIds, topK, conversationId)
 * @returns RAG response with answer and sources
 */
export async function query(
  db: ExtendedDatabase,
  userId: string,
  campaignId: string,
  query: string,
  options: RAGQueryOptions = {}
): Promise<RAGResponse> {
  const startTime = Date.now();

  logger.info('RAG query started', {
    userId,
    campaignId,
    query: query.substring(0, 100),
    options,
  });

  // Verify campaign access
  await verifyCampaignOwnership(db, userId, campaignId);

  // Search for relevant chunks using hybrid search
  const searchStart = Date.now();
  const chunks = await hybridSearch(
    db,
    campaignId,
    query,
    options.topK || 10,
    { resourceIds: options.resourceIds }
  );
  const searchLatencyMs = Date.now() - searchStart;

  logger.debug('Chunks retrieved', {
    count: chunks.length,
    searchLatencyMs,
  });

  // Early return if no chunks found - avoid unnecessary LLM call
  if (chunks.length === 0) {
    logger.info('No chunks found for query, returning early without LLM call', {
      userId,
      campaignId,
      query: query.substring(0, 100),
    });

    return {
      queryId: uuidv4(),
      answer: "I don't have any information about that in your uploaded materials. You may need to upload relevant resources first, or try rephrasing your question.",
      sources: [],
      metadata: {
        model: 'none',
        promptTokens: 0,
        completionTokens: 0,
        latencyMs: Date.now() - startTime,
        searchLatencyMs,
        llmLatencyMs: 0,
        chunksRetrieved: 0,
        conversationId: options.conversationId || uuidv4(),
      },
    };
  }

  // Generate answer using LLM
  const llmStart = Date.now();
  const { answer, promptTokens, completionTokens } = await generateAnswer(query, chunks);
  const llmLatencyMs = Date.now() - llmStart;

  // Create or use provided conversation ID
  const conversationId = options.conversationId || uuidv4();

  // Log query to database
  const queryId = await logQuery(db, {
    campaignId,
    userId,
    query,
    retrievedChunkIds: chunks.map((c) => c.chunkId),
    retrievedChunkScores: chunks.map((c) => c.score),
    answer,
    model: 'gpt-4o-mini',
    promptTokens,
    completionTokens,
    latencyMs: Date.now() - startTime,
    conversationId,
  });

  // Format sources for response
  const sources: SourceChunk[] = chunks.map((chunk, i) => ({
    chunkId: chunk.chunkId,
    resourceId: chunk.resourceId,
    fileName: chunk.fileName,
    pageNumber: chunk.pageNumber,
    sectionHeading: chunk.sectionHeading,
    contentPreview: chunk.content.substring(0, 200),
    similarityScore: chunk.score,
    rank: i + 1,
  }));

  const totalLatencyMs = Date.now() - startTime;

  logger.info('RAG query completed', {
    queryId,
    campaignId,
    userId,
    totalLatencyMs,
    searchLatencyMs,
    llmLatencyMs,
    promptTokens,
    completionTokens,
    chunksRetrieved: chunks.length,
  });

  return {
    queryId,
    answer,
    sources,
    metadata: {
      model: 'gpt-4o-mini',
      promptTokens,
      completionTokens,
      latencyMs: totalLatencyMs,
      searchLatencyMs,
      llmLatencyMs,
      chunksRetrieved: chunks.length,
      conversationId,
    },
  };
}
