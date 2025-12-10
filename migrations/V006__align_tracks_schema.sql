-- V005: Align music system schema with application code
-- Fix mismatches between database schema and TypeScript types

-- ============================================================================
-- TRACKS TABLE FIXES
-- ============================================================================

-- 1. Rename track_url to file_url to match application code
ALTER TABLE tracks RENAME COLUMN track_url TO file_url;

-- 2. Remove NOT NULL constraint from file_url (tracks start as pending without URL)
ALTER TABLE tracks ALTER COLUMN file_url DROP NOT NULL;

-- 3. Rename gm_notes to notes to match TypeScript types
ALTER TABLE tracks RENAME COLUMN gm_notes TO notes;

-- 4. Make provider nullable (Suno is hardcoded, field not actively used)
ALTER TABLE tracks ALTER COLUMN provider DROP NOT NULL;

-- 5. Update provider_id to match suno_track_id usage in code
ALTER TABLE tracks RENAME COLUMN provider_id TO suno_track_id;

-- Add comments for clarity
COMMENT ON COLUMN tracks.file_url IS 'URL to the generated audio file, set after track generation completes';
COMMENT ON COLUMN tracks.suno_track_id IS 'Suno API track identifier for status polling';
COMMENT ON COLUMN tracks.provider IS 'Music generation provider (e.g. suno, udio) - currently unused as Suno is hardcoded';

-- ============================================================================
-- MUSIC_SCENES TABLE FIXES
-- ============================================================================

-- 6. Add campaign_id column (services query by campaign_id, not session_id)
ALTER TABLE music_scenes ADD COLUMN campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE;

-- 7. Populate campaign_id from sessions table for existing records
UPDATE music_scenes
SET campaign_id = (SELECT campaign_id FROM sessions WHERE sessions.id = music_scenes.session_id)
WHERE campaign_id IS NULL;

-- 8. Make campaign_id NOT NULL after population
ALTER TABLE music_scenes ALTER COLUMN campaign_id SET NOT NULL;

-- 9. Create index for campaign_id queries (performance)
CREATE INDEX idx_campaign_music_scenes ON music_scenes(campaign_id);

COMMENT ON COLUMN music_scenes.campaign_id IS 'Campaign that owns this music scene (denormalized for query performance)';
