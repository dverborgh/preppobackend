-- Migration V005: Add RAG Query Logging
-- Adds table for logging all RAG queries with retrieved chunks, LLM responses, and performance metrics

-- Table: rag_queries
-- Purpose: Store all RAG query executions for evaluation and debugging
-- Log all queries, retrieved chunks, LLM responses, and performance metrics
CREATE TABLE rag_queries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Query context
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),

  -- Query content
  query_text TEXT NOT NULL,
  query_embedding VECTOR(1536), -- Optional: store query embedding for analysis

  -- Retrieval results
  retrieved_chunk_ids UUID[] NOT NULL,
  retrieved_chunk_scores DECIMAL(5,4)[], -- Similarity/relevance scores for each chunk

  -- LLM response
  llm_response TEXT NOT NULL,
  llm_model VARCHAR(100) NOT NULL,
  prompt_tokens INTEGER NOT NULL,
  completion_tokens INTEGER NOT NULL,

  -- Performance metrics
  latency_ms INTEGER NOT NULL,

  -- Optional conversation context
  conversation_id UUID, -- For multi-turn conversations

  -- User feedback (populated after query execution)
  feedback_rating INTEGER CHECK (feedback_rating BETWEEN 1 AND 5),
  feedback_comment TEXT,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  feedback_updated_at TIMESTAMP WITH TIME ZONE
);

-- Indexes for efficient querying
CREATE INDEX idx_rag_queries_campaign
  ON rag_queries(campaign_id, created_at DESC);

CREATE INDEX idx_rag_queries_user
  ON rag_queries(user_id, created_at DESC);

CREATE INDEX idx_rag_queries_conversation
  ON rag_queries(conversation_id, created_at ASC)
  WHERE conversation_id IS NOT NULL;

-- Index for feedback analysis
CREATE INDEX idx_rag_queries_feedback
  ON rag_queries(feedback_rating)
  WHERE feedback_rating IS NOT NULL;

-- Comments for documentation
COMMENT ON TABLE rag_queries IS
  'Logs all RAG query executions with retrieved chunks, LLM responses, and performance metrics for evaluation and debugging';

COMMENT ON COLUMN rag_queries.query_embedding IS
  'Optional query embedding for similarity analysis and debugging retrieval quality';

COMMENT ON COLUMN rag_queries.retrieved_chunk_scores IS
  'Similarity or relevance scores for each retrieved chunk (aligned with retrieved_chunk_ids array)';

COMMENT ON COLUMN rag_queries.conversation_id IS
  'Groups related queries in a multi-turn conversation for context tracking';

COMMENT ON COLUMN rag_queries.feedback_rating IS
  'User feedback on answer quality (1=poor, 5=excellent)';
