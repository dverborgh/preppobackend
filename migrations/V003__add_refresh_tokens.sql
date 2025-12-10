-- V003: Add refresh_tokens table for authentication
-- Supports JWT refresh token rotation for secure authentication

-- ============================================================
-- REFRESH TOKENS TABLE
-- ============================================================
CREATE TABLE refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Store SHA256 hash of the refresh token (not the token itself)
  token_hash VARCHAR(64) NOT NULL UNIQUE,

  -- Expiration time (default 7 days from creation)
  expires_at TIMESTAMP NOT NULL,

  -- Revocation support for logout and token rotation
  revoked BOOLEAN NOT NULL DEFAULT FALSE,
  revoked_at TIMESTAMP,

  -- Tracking
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at TIMESTAMP,

  -- IP address tracking for security (optional)
  created_ip VARCHAR(45),
  last_used_ip VARCHAR(45)
);

-- Index for fast token lookup by hash
CREATE INDEX idx_refresh_token_hash ON refresh_tokens(token_hash) WHERE revoked = FALSE;

-- Index for user's active tokens
CREATE INDEX idx_user_refresh_tokens ON refresh_tokens(user_id, created_at DESC) WHERE revoked = FALSE;

-- Index for cleanup of expired tokens
CREATE INDEX idx_refresh_token_expires ON refresh_tokens(expires_at) WHERE revoked = FALSE;

-- Add comment explaining token storage security
COMMENT ON COLUMN refresh_tokens.token_hash IS 'SHA256 hash of the actual refresh token. Never store tokens in plain text.';
