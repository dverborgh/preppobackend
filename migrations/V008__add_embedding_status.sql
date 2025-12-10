-- V008: Add support for tracking embedding generation status
-- This migration adds a new 'completed_no_embeddings' status to track resources
-- that successfully processed but failed to generate embeddings.

-- Update ingestion_status constraint to include new status
ALTER TABLE resources DROP CONSTRAINT IF EXISTS valid_ingestion_status;
ALTER TABLE resources ADD CONSTRAINT valid_ingestion_status CHECK (
  ingestion_status IN ('pending', 'processing', 'completed', 'completed_no_embeddings', 'failed')
);

-- Add index to find resources needing embedding backfill
CREATE INDEX IF NOT EXISTS idx_resources_no_embeddings ON resources(campaign_id)
  WHERE ingestion_status = 'completed_no_embeddings';

-- Add comment for documentation
COMMENT ON COLUMN resources.ingestion_status IS
  'Resource processing status. completed_no_embeddings indicates text extraction and chunking succeeded but embedding generation failed (can be retried).';
