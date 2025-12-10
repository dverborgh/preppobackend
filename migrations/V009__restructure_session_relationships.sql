-- V009: Restructure session relationships
-- 1. Add session_id to generators and resources tables
-- 2. Remove scene-based organization (session_scenes, session_scene_generators)
-- 3. Remove session packets system
-- 4. Remove soundboard_sessions

-- ============================================================
-- STEP 1: Drop tables with foreign key dependencies first
-- ============================================================

-- Drop soundboard_sessions (references tracks and sessions)
DROP TABLE IF EXISTS soundboard_sessions CASCADE;

-- Drop session_packet_chunks (references session_packets and resource_chunks)
DROP TABLE IF EXISTS session_packet_chunks CASCADE;

-- Drop session_packets (references sessions)
DROP TABLE IF EXISTS session_packets CASCADE;

-- Drop session_scene_generators (references session_scenes and generators)
DROP TABLE IF EXISTS session_scene_generators CASCADE;

-- ============================================================
-- STEP 2: Modify tables that reference session_scenes
-- ============================================================

-- Remove scene_id from generator_rolls (keep session_id only)
ALTER TABLE generator_rolls
  DROP COLUMN IF EXISTS scene_id;

-- Modify music_scenes to remove scene_id and related constraints
-- (music_scenes already has session_id, so we just remove the scene-based relationship)
ALTER TABLE music_scenes
  DROP CONSTRAINT IF EXISTS unique_scene_music;

ALTER TABLE music_scenes
  DROP COLUMN IF EXISTS scene_id;

-- Drop the scene-specific index
DROP INDEX IF EXISTS idx_scene_music;

-- ============================================================
-- STEP 3: Drop session_scenes table
-- ============================================================
DROP TABLE IF EXISTS session_scenes CASCADE;

-- ============================================================
-- STEP 4: Add session_id to generators table
-- ============================================================
ALTER TABLE generators
  ADD COLUMN session_id UUID REFERENCES sessions(id) ON DELETE CASCADE;

-- Create index on generators.session_id
CREATE INDEX idx_generators_session ON generators(session_id) WHERE session_id IS NOT NULL;

-- ============================================================
-- STEP 5: Add session_id to resources table
-- ============================================================
ALTER TABLE resources
  ADD COLUMN session_id UUID REFERENCES sessions(id) ON DELETE CASCADE;

-- Create index on resources.session_id
CREATE INDEX idx_resources_session ON resources(session_id) WHERE session_id IS NOT NULL;

-- ============================================================
-- NOTES
-- ============================================================
-- This migration restructures the data model to use direct session relationships
-- instead of scene-based organization:
--
-- OLD MODEL:
-- - session_scenes: Scene-based organization within sessions
-- - session_scene_generators: Junction table linking scenes to generators
-- - session_packets: Manual packet creation system
-- - session_packet_chunks: Junction table for packet contents
-- - soundboard_sessions: Soundboard state management
--
-- NEW MODEL:
-- - generators.session_id: Direct relationship (generators can optionally belong to sessions)
-- - resources.session_id: Direct relationship (resources can optionally belong to sessions)
-- - music_scenes: Now only references session_id (removed scene_id)
-- - generator_rolls: Now only references session_id (removed scene_id)
--
-- This simplifies the data model and removes the need for scene-based organization.
