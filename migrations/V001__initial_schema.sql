-- V001: Initial database schema for Preppo
-- Creates core tables: users, campaigns, sessions, scenes, generators, resources

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Enable uuid generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- USERS TABLE
-- ============================================================
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  username VARCHAR(100) UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login TIMESTAMP,
  preferences JSONB DEFAULT '{}'::jsonb,
  is_active BOOLEAN DEFAULT TRUE
);

CREATE INDEX idx_user_email ON users(email);
CREATE INDEX idx_user_username ON users(username) WHERE username IS NOT NULL;

-- ============================================================
-- CAMPAIGNS TABLE
-- ============================================================
CREATE TABLE campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  system_name VARCHAR(100) NOT NULL,
  description TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  metadata JSONB DEFAULT '{}'::jsonb,

  CONSTRAINT unique_campaign_name_per_user UNIQUE(user_id, name)
);

CREATE INDEX idx_user_campaigns ON campaigns(user_id, created_at DESC);
CREATE INDEX idx_campaign_updated ON campaigns(updated_at DESC);

-- ============================================================
-- SESSIONS TABLE
-- ============================================================
CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  session_number INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  scheduled_date DATE,
  description TEXT,
  notes TEXT,
  duration_minutes INT,

  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  preparation_notes TEXT,
  gm_objectives JSONB DEFAULT '[]'::jsonb,

  is_active BOOLEAN DEFAULT FALSE,
  started_at TIMESTAMP,

  CONSTRAINT valid_status CHECK (status IN ('draft', 'planned', 'in-progress', 'completed')),
  CONSTRAINT valid_session_number CHECK (session_number > 0)
);

CREATE INDEX idx_campaign_sessions ON sessions(campaign_id, session_number);
CREATE INDEX idx_active_sessions ON sessions(campaign_id, is_active) WHERE is_active = TRUE;
CREATE INDEX idx_session_status ON sessions(campaign_id, status);

-- ============================================================
-- SESSION SCENES TABLE
-- ============================================================
CREATE TABLE session_scenes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  scene_number INT NOT NULL,

  name VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  location VARCHAR(255),
  npc_names TEXT[] DEFAULT ARRAY[]::TEXT[],

  encounter_level VARCHAR(50),
  expected_duration_minutes INT,

  music_mood VARCHAR(100),
  atmosphere_notes TEXT,

  is_current BOOLEAN DEFAULT FALSE,

  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT valid_scene_number CHECK (scene_number > 0)
);

CREATE INDEX idx_session_scenes ON session_scenes(session_id, scene_number);
CREATE INDEX idx_current_scene ON session_scenes(session_id, is_current) WHERE is_current = TRUE;

-- ============================================================
-- GENERATORS TABLE
-- ============================================================
CREATE TABLE generators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,

  name VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,

  mode VARCHAR(20) NOT NULL,

  output_schema JSONB NOT NULL,
  output_example JSONB,

  primary_table_id UUID,

  created_by_prompt TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  status VARCHAR(20) DEFAULT 'active',

  CONSTRAINT valid_mode CHECK (mode IN ('table', 'llm'))
);

CREATE INDEX idx_campaign_generators ON generators(campaign_id, status);
CREATE INDEX idx_generator_created ON generators(campaign_id, created_at DESC);

-- ============================================================
-- GENERATOR TABLES TABLE
-- ============================================================
CREATE TABLE generator_tables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  generator_id UUID NOT NULL REFERENCES generators(id) ON DELETE CASCADE,

  parent_table_id UUID REFERENCES generator_tables(id),

  name VARCHAR(255) NOT NULL,
  description TEXT,

  roll_method VARCHAR(50) NOT NULL DEFAULT 'weighted_random',

  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT valid_roll_method CHECK (
    roll_method IN ('weighted_random', 'sequential', 'range_based')
  )
);

CREATE INDEX idx_generator_tables ON generator_tables(generator_id);
CREATE INDEX idx_parent_tables ON generator_tables(parent_table_id) WHERE parent_table_id IS NOT NULL;

-- Add foreign key for primary_table_id after generator_tables is created
ALTER TABLE generators
  ADD CONSTRAINT fk_primary_table
  FOREIGN KEY (primary_table_id)
  REFERENCES generator_tables(id);

ALTER TABLE generators
  ADD CONSTRAINT table_mode_requires_table CHECK (
    (mode = 'table' AND primary_table_id IS NOT NULL) OR
    (mode != 'table')
  );

-- ============================================================
-- GENERATOR ENTRIES TABLE
-- ============================================================
CREATE TABLE generator_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_id UUID NOT NULL REFERENCES generator_tables(id) ON DELETE CASCADE,

  entry_key VARCHAR(255) NOT NULL,
  entry_text TEXT NOT NULL,

  weight INT NOT NULL DEFAULT 1,

  roll_min INT,
  roll_max INT,

  subtable_id UUID REFERENCES generator_tables(id),

  display_order INT DEFAULT 0,

  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT unique_entry_key UNIQUE(table_id, entry_key),
  CONSTRAINT range_valid CHECK (
    (roll_min IS NULL AND roll_max IS NULL) OR
    (roll_min IS NOT NULL AND roll_max IS NOT NULL AND roll_min <= roll_max)
  ),
  CONSTRAINT weight_positive CHECK (weight > 0)
);

CREATE INDEX idx_table_entries ON generator_entries(table_id, display_order);

-- ============================================================
-- GENERATOR ROLLS TABLE
-- ============================================================
CREATE TABLE generator_rolls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  generator_id UUID NOT NULL REFERENCES generators(id),
  session_id UUID NOT NULL REFERENCES sessions(id),
  scene_id UUID REFERENCES session_scenes(id),

  rolled_value JSONB NOT NULL,

  random_seed VARCHAR(255),
  roll_timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  rolled_by_user_id UUID REFERENCES users(id),

  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_generator_rolls ON generator_rolls(generator_id, session_id);
CREATE INDEX idx_session_rolls ON generator_rolls(session_id, roll_timestamp DESC);
CREATE INDEX idx_scene_rolls ON generator_rolls(scene_id, roll_timestamp DESC) WHERE scene_id IS NOT NULL;

-- ============================================================
-- RESOURCES TABLE
-- ============================================================
CREATE TABLE resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,

  original_filename VARCHAR(255) NOT NULL,
  file_url VARCHAR(500) NOT NULL,
  file_size_bytes INT,
  content_type VARCHAR(50),

  resource_type VARCHAR(50),
  title VARCHAR(255),
  author VARCHAR(255),
  uploaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  ingestion_status VARCHAR(20) DEFAULT 'pending',
  ingestion_error TEXT,
  total_pages INT,
  total_chunks INT,

  metadata JSONB DEFAULT '{}'::jsonb,

  CONSTRAINT valid_resource_type CHECK (
    resource_type IN ('rules', 'lore', 'setting', 'homebrew', 'other')
  ),
  CONSTRAINT valid_ingestion_status CHECK (
    ingestion_status IN ('pending', 'processing', 'completed', 'failed')
  )
);

CREATE INDEX idx_campaign_resources ON resources(campaign_id, resource_type);
CREATE INDEX idx_resource_status ON resources(campaign_id, ingestion_status);

-- ============================================================
-- RESOURCE CHUNKS TABLE
-- ============================================================
CREATE TABLE resource_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id UUID NOT NULL REFERENCES resources(id) ON DELETE CASCADE,

  chunk_index INT NOT NULL,
  page_number INT,

  raw_text TEXT NOT NULL,

  embedding VECTOR(1536),

  token_count INT,
  section_heading VARCHAR(255),

  tags TEXT[] DEFAULT ARRAY[]::TEXT[],

  quality_score FLOAT DEFAULT 0.5,

  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT valid_chunk_index CHECK (chunk_index >= 0),
  CONSTRAINT valid_quality_score CHECK (quality_score >= 0 AND quality_score <= 1)
);

CREATE INDEX idx_resource_chunks ON resource_chunks(resource_id, chunk_index);
CREATE INDEX idx_chunk_page ON resource_chunks(resource_id, page_number) WHERE page_number IS NOT NULL;

-- HNSW index for vector similarity search (cosine distance)
CREATE INDEX idx_chunk_embedding ON resource_chunks
  USING hnsw (embedding vector_cosine_ops);

-- GIN index for tags array
CREATE INDEX idx_chunk_tags ON resource_chunks USING gin(tags);

-- Full-text search index for keyword search
CREATE INDEX idx_chunk_text_search ON resource_chunks
  USING gin(to_tsvector('english', raw_text));

-- ============================================================
-- SESSION SCENE GENERATORS (junction table)
-- ============================================================
CREATE TABLE session_scene_generators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scene_id UUID NOT NULL REFERENCES session_scenes(id) ON DELETE CASCADE,
  generator_id UUID NOT NULL REFERENCES generators(id) ON DELETE CASCADE,

  display_order INT NOT NULL DEFAULT 0,
  context_notes TEXT,

  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT unique_scene_generator UNIQUE(scene_id, generator_id)
);

CREATE INDEX idx_scene_generators ON session_scene_generators(scene_id, display_order);

-- ============================================================
-- TRIGGER: Update updated_at timestamp
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_campaigns_updated_at
  BEFORE UPDATE ON campaigns
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_sessions_updated_at
  BEFORE UPDATE ON sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_session_scenes_updated_at
  BEFORE UPDATE ON session_scenes
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_generators_updated_at
  BEFORE UPDATE ON generators
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_resource_chunks_updated_at
  BEFORE UPDATE ON resource_chunks
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- INITIAL DATA (optional)
-- ============================================================
-- Create a default test user in development
-- Password: 'test123456789' (bcrypt hash with 12 rounds)
-- INSERT INTO users (email, password_hash, name, username)
-- VALUES (
--   'test@preppo.local',
--   '$2b$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW',
--   'Test User',
--   'testuser'
-- );
