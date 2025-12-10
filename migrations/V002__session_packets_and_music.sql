-- V002: Add session packets and music system tables

-- ============================================================
-- SESSION PACKETS TABLE
-- ============================================================
CREATE TABLE session_packets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,

  name VARCHAR(255) NOT NULL,
  description TEXT,

  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  generation_status VARCHAR(20) DEFAULT 'draft',

  scene_ids UUID[] DEFAULT ARRAY[]::UUID[],

  CONSTRAINT valid_generation_status CHECK (
    generation_status IN ('draft', 'auto_generated', 'reviewed', 'finalized')
  )
);

CREATE INDEX idx_session_packets ON session_packets(session_id, created_at DESC);

-- ============================================================
-- SESSION PACKET CHUNKS (junction table)
-- ============================================================
CREATE TABLE session_packet_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  packet_id UUID NOT NULL REFERENCES session_packets(id) ON DELETE CASCADE,
  chunk_id UUID NOT NULL REFERENCES resource_chunks(id) ON DELETE CASCADE,

  inclusion_reason VARCHAR(255),
  notes TEXT,

  added_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  added_by_user_id UUID REFERENCES users(id),

  CONSTRAINT unique_packet_chunk UNIQUE(packet_id, chunk_id)
);

CREATE INDEX idx_packet_contents ON session_packet_chunks(packet_id);

-- ============================================================
-- MUSIC SCENES TABLE
-- ============================================================
CREATE TABLE music_scenes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  scene_id UUID NOT NULL REFERENCES session_scenes(id) ON DELETE CASCADE,

  name VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,

  primary_mood VARCHAR(100),
  tempo VARCHAR(50),
  duration_seconds INT,

  instrument_preferences TEXT[] DEFAULT ARRAY[]::TEXT[],

  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT unique_scene_music UNIQUE(scene_id)
);

CREATE INDEX idx_session_music ON music_scenes(session_id);
CREATE INDEX idx_scene_music ON music_scenes(scene_id);

-- ============================================================
-- TRACK RECIPES TABLE
-- ============================================================
CREATE TABLE track_recipes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  music_scene_id UUID NOT NULL REFERENCES music_scenes(id) ON DELETE CASCADE,

  version INT NOT NULL DEFAULT 1,

  prompt TEXT NOT NULL,
  bpm INT,
  mood_tags TEXT[] DEFAULT ARRAY[]::TEXT[],
  style VARCHAR(100),

  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by_user_id UUID REFERENCES users(id),

  quality_rating INT DEFAULT 0,

  CONSTRAINT valid_quality_rating CHECK (quality_rating IN (-1, 0, 1)),
  CONSTRAINT valid_bpm CHECK (bpm IS NULL OR (bpm >= 60 AND bpm <= 200))
);

CREATE INDEX idx_scene_recipes ON track_recipes(music_scene_id, version DESC);

-- ============================================================
-- TRACKS TABLE
-- ============================================================
CREATE TABLE tracks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id UUID NOT NULL REFERENCES track_recipes(id) ON DELETE CASCADE,

  track_url VARCHAR(500) NOT NULL,
  duration_seconds INT,
  audio_format VARCHAR(20),

  provider VARCHAR(50) NOT NULL,
  provider_id VARCHAR(255),

  quality_rating INT DEFAULT 0,
  gm_notes TEXT,

  generated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT valid_quality_rating CHECK (quality_rating IN (-1, 0, 1))
);

CREATE INDEX idx_recipe_tracks ON tracks(recipe_id);
CREATE INDEX idx_track_quality ON tracks(recipe_id, quality_rating DESC);

-- ============================================================
-- SOUNDBOARD SESSIONS TABLE
-- ============================================================
CREATE TABLE soundboard_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,

  currently_playing_track_id UUID REFERENCES tracks(id),
  current_position_seconds FLOAT DEFAULT 0,
  is_playing BOOLEAN DEFAULT FALSE,

  queue_track_ids UUID[] DEFAULT ARRAY[]::UUID[],

  master_volume FLOAT DEFAULT 1.0,
  crossfade_duration_ms INT DEFAULT 3000,

  last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT valid_volume CHECK (master_volume >= 0 AND master_volume <= 1),
  CONSTRAINT valid_position CHECK (current_position_seconds >= 0),
  CONSTRAINT valid_crossfade CHECK (crossfade_duration_ms >= 0)
);

CREATE INDEX idx_active_soundboards ON soundboard_sessions(session_id, is_playing);
CREATE UNIQUE INDEX idx_session_soundboard ON soundboard_sessions(session_id);

-- ============================================================
-- UPDATE TRIGGERS for new tables
-- ============================================================
CREATE TRIGGER update_session_packets_updated_at
  BEFORE UPDATE ON session_packets
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_music_scenes_updated_at
  BEFORE UPDATE ON music_scenes
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
