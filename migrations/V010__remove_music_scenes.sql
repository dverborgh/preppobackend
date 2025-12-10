-- V010: Remove music_scenes and add direct campaign/session relationships to tracks
-- 1. Remove music_scene_id from track_recipes
-- 2. Add campaign_id and session_id to track_recipes
-- 3. Add campaign_id and session_id to tracks
-- 4. Drop music_scenes table

-- ============================================================
-- STEP 1: Modify track_recipes to remove scene reference
-- ============================================================

-- Drop the index that references music_scene_id
DROP INDEX IF EXISTS idx_scene_recipes;

-- Remove the music_scene_id column (this will also drop the foreign key)
ALTER TABLE track_recipes
  DROP COLUMN IF EXISTS music_scene_id;

-- ============================================================
-- STEP 2: Add campaign_id and session_id to track_recipes
-- ============================================================

ALTER TABLE track_recipes
  ADD COLUMN campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
  ADD COLUMN session_id UUID REFERENCES sessions(id) ON DELETE CASCADE;

-- Create indexes for track_recipes
CREATE INDEX idx_track_recipes_campaign ON track_recipes(campaign_id) WHERE campaign_id IS NOT NULL;
CREATE INDEX idx_track_recipes_session ON track_recipes(session_id) WHERE session_id IS NOT NULL;

-- ============================================================
-- STEP 3: Add campaign_id and session_id to tracks
-- ============================================================

ALTER TABLE tracks
  ADD COLUMN campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
  ADD COLUMN session_id UUID REFERENCES sessions(id) ON DELETE CASCADE;

-- Create indexes for tracks
CREATE INDEX idx_tracks_campaign ON tracks(campaign_id) WHERE campaign_id IS NOT NULL;
CREATE INDEX idx_tracks_session ON tracks(session_id) WHERE session_id IS NOT NULL;

-- ============================================================
-- STEP 4: Drop music_scenes table
-- ============================================================

-- Drop the update trigger first
DROP TRIGGER IF EXISTS update_music_scenes_updated_at ON music_scenes;

-- Drop the session music index
DROP INDEX IF EXISTS idx_session_music;

-- Drop the table
DROP TABLE IF EXISTS music_scenes CASCADE;

-- ============================================================
-- NOTES
-- ============================================================
-- This migration simplifies the music system by removing the music_scenes layer:
--
-- OLD MODEL:
-- - music_scenes (linked to session and scene)
-- - track_recipes (linked to music_scene)
-- - tracks (linked to recipe)
--
-- NEW MODEL:
-- - track_recipes (linked to campaign/session, contains prompt/config)
-- - tracks (linked to recipe and campaign/session, contains generated audio)
--
-- Both campaign_id and session_id are nullable on both tables:
-- - Recipes/tracks can be campaign-level (reusable) or session-specific
-- - Recipes/tracks can exist without being assigned to a campaign/session
