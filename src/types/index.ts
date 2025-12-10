/**
 * Core type definitions for Preppo backend
 */

// Database model types
export interface User {
  id: string;
  email: string;
  password_hash: string;
  name?: string;
  username?: string;
  created_at: Date;
  last_login?: Date;
  preferences?: Record<string, any>;
  is_active: boolean;
}

export interface Campaign {
  id: string;
  user_id: string;
  name: string;
  system_name: string;
  description?: string;
  created_at: Date;
  updated_at: Date;
  metadata?: Record<string, any>;
}

export interface Session {
  id: string;
  campaign_id: string;
  session_number: number;
  name: string;
  scheduled_date?: Date;
  description?: string;
  notes?: string;
  duration_minutes?: number;
  status: 'draft' | 'planned' | 'in-progress' | 'completed';
  created_at: Date;
  updated_at: Date;
  preparation_notes?: string;
  gm_objectives?: string[];
  is_active: boolean;
  started_at?: Date;
}

export interface Generator {
  id: string;
  campaign_id: string;
  name: string;
  description: string;
  mode: 'table' | 'llm';
  output_schema: Record<string, any>;
  output_example?: Record<string, any>;
  primary_table_id?: string;
  created_by_prompt?: string;
  created_at: Date;
  updated_at: Date;
  status: 'active' | 'archived' | 'testing';
}

export interface GeneratorTable {
  id: string;
  generator_id: string;
  parent_table_id?: string;
  name: string;
  description?: string;
  roll_method: 'weighted_random' | 'sequential' | 'range_based';
  created_at: Date;
}

export interface GeneratorEntry {
  id: string;
  table_id: string;
  entry_key: string;
  entry_text: string;
  weight: number;
  roll_min?: number;
  roll_max?: number;
  subtable_id?: string;
  display_order: number;
  created_at: Date;
}

export interface GeneratorRoll {
  id: string;
  generator_id: string;
  session_id: string;
  rolled_value: Record<string, any>;
  random_seed?: string;
  roll_timestamp: Date;
  rolled_by_user_id?: string;
  created_at: Date;
}

export interface Resource {
  id: string;
  campaign_id: string;
  original_filename: string;
  file_url: string;
  file_size_bytes?: number;
  content_type?: string;
  resource_type?: 'rules' | 'lore' | 'setting' | 'homebrew' | 'other';
  title?: string;
  author?: string;
  uploaded_at: Date;
  ingestion_status: 'pending' | 'processing' | 'completed' | 'failed';
  ingestion_error?: string;
  total_pages?: number;
  total_chunks?: number;
  metadata?: Record<string, any>;
}

export interface ResourceChunk {
  id: string;
  resource_id: string;
  chunk_index: number;
  page_number?: number;
  raw_text: string;
  embedding?: number[];
  token_count?: number;
  section_heading?: string;
  tags?: string[];
  quality_score: number;
  created_at: Date;
  updated_at: Date;
}

export interface TrackRecipe {
  id: string;
  campaign_id?: string;
  session_id?: string;
  recipe_name: string;
  prompt: string;
  bpm?: number;
  mood_tags?: string[];
  style_tags?: string[];
  instrument_tags?: string[];
  created_at: Date;
}

export interface Track {
  id: string;
  recipe_id: string;
  campaign_id?: string;
  session_id?: string;
  suno_track_id?: string;
  file_url?: string;
  duration_seconds?: number;
  quality_rating: -1 | 0 | 1;
  notes?: string;
  created_at: Date;
}

// JWT Payload
export interface JWTPayload {
  sub: string; // user_id
  email: string;
  iat: number;
  exp: number;
  iss: string;
}

// API Request/Response types
export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  name?: string;
}

export interface AuthResponse {
  token: string;
  user_id: string;
  expires_in: number;
}

export interface GeneratorDesignRequest {
  natural_language_spec: string;
  system_name?: string;
}

export interface GeneratorRollRequest {
  session_id: string;
  seed?: string;
}

export interface RAGQuestionRequest {
  question: string;
  resource_ids?: string[];
  num_chunks?: number;
}

export interface RAGQuestionResponse {
  question: string;
  answer: string;
  sources: Array<{
    resource_id: string;
    resource_title: string;
    chunk_id: string;
    page_number?: number;
    section_heading?: string;
    excerpt: string;
    relevance_score: number;
  }>;
  confidence_score: number;
  answered_at: Date;
}

// Error types
export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: any
  ) {
    super(message);
    this.name = 'AppError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: any) {
    super(400, 'VALIDATION_ERROR', message, details);
    this.name = 'ValidationError';
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(401, 'UNAUTHORIZED', message);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(403, 'FORBIDDEN', message);
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(404, 'NOT_FOUND', `${resource} not found`);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, 'CONFLICT', message);
    this.name = 'ConflictError';
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message: string, public retryAfterSeconds?: number) {
    super(503, 'SERVICE_UNAVAILABLE', message);
    this.name = 'ServiceUnavailableError';
  }
}

export class InvalidFileTypeError extends AppError {
  constructor(message: string) {
    super(400, 'INVALID_FILE_TYPE', message);
    this.name = 'InvalidFileTypeError';
  }
}

export class FileSizeLimitError extends AppError {
  constructor(message: string) {
    super(413, 'FILE_SIZE_LIMIT_EXCEEDED', message);
    this.name = 'FileSizeLimitError';
  }
}

// Utility types
export type Pagination = {
  skip: number;
  limit: number;
  total: number;
};

export type PaginatedResponse<T> = {
  data: T[];
  total: number;
  skip: number;
  limit: number;
};
