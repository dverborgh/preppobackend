-- Migration V004: Add processing metadata columns to resources table
-- Adds columns to track processing timeline, retry count, and duration

-- Add processing timestamps and retry count to resources table
ALTER TABLE resources
  ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS processing_completed_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS processing_retry_count INTEGER DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS processing_duration_ms INTEGER;

-- Add index for filtering by processing status and created_at
-- This improves query performance when listing resources by status
CREATE INDEX IF NOT EXISTS idx_resources_processing_status
  ON resources(ingestion_status, uploaded_at DESC);

-- Add index for resource_chunks by resource_id for faster queries
-- This improves performance when counting chunks or retrieving chunks for a resource
CREATE INDEX IF NOT EXISTS idx_resource_chunks_resource_id
  ON resource_chunks(resource_id, chunk_index);

-- Add metadata column to resource_chunks for storing additional chunk-level information
ALTER TABLE resource_chunks
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

-- Add comments for documentation
COMMENT ON COLUMN resources.processing_started_at IS 'Timestamp when processing job started';
COMMENT ON COLUMN resources.processing_completed_at IS 'Timestamp when processing job completed (success or failure)';
COMMENT ON COLUMN resources.processing_retry_count IS 'Number of times processing has been attempted';
COMMENT ON COLUMN resources.processing_duration_ms IS 'Duration of processing in milliseconds';
COMMENT ON COLUMN resource_chunks.metadata IS 'Additional metadata for the chunk (JSON format)';
