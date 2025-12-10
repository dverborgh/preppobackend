# Preppo Backend

A high-performance Node.js/TypeScript backend for Preppo, a tabletop RPG GM assistant with RAG-powered campaign knowledge, instant generator rolls, and AI music generation.

## Features

- **Campaign Knowledge Management** - RAG system with pgvector for semantic search
- **Random Content Generation** - <50ms deterministic generator rolls for active play
- **Music Generation** - AI-powered scene music with Suno API integration
- **High Performance** - Optimized for Session Console operations
- **Enterprise Security** - JWT auth, bcrypt hashing, rate limiting, input validation

## Tech Stack

- **Runtime:** Node.js 20+ with TypeScript
- **Framework:** Express.js
- **Database:** PostgreSQL 15+ with pgvector extension
- **Cache:** Redis 7+
- **LLM:** OpenAI API (GPT-4, GPT-4 mini, text-embedding-3-small)
- **Storage:** S3-compatible object storage
- **Music:** Suno API (or compatible provider)

## Quick Start

### Prerequisites

- Node.js 20+
- PostgreSQL 15+ with pgvector
- Redis 7+
- OpenAI API key

### Installation

```bash
# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env with your configuration
nano .env

# Run database migrations
npm run migrate

# Start development server
npm run dev
```

### Environment Configuration

See `.env.example` for all configuration options. Required variables:

- `DATABASE_*` - PostgreSQL connection details
- `REDIS_*` - Redis connection details
- `JWT_SECRET` - Secret for JWT token signing (min 32 chars)
- `OPENAI_API_KEY` - OpenAI API key for LLM features
- `S3_*` - S3 credentials for file storage

## Development

```bash
# Development server with auto-reload
npm run dev

# Build TypeScript
npm run build

# Run tests
npm test

# Run integration tests
npm run test:integration

# Lint code
npm run lint

# Fix linting issues
npm run lint:fix
```

## Database Migrations

```bash
# Run all pending migrations
npm run migrate

# Create new migration (manual)
touch migrations/V00X__description.sql
```

## API Documentation

The API follows RESTful conventions. Base URL: `/api`

### Authentication

All authenticated endpoints require `Authorization: Bearer <token>` header.

**Register:**
```bash
POST /api/auth/register
{
  "email": "gm@example.com",
  "password": "SecurePass123!@#",
  "name": "GM Name"
}
```

**Login:**
```bash
POST /api/auth/login
{
  "email": "gm@example.com",
  "password": "SecurePass123!@#"
}
```

### Campaigns

```bash
GET /api/campaigns              # List user's campaigns
POST /api/campaigns             # Create campaign
GET /api/campaigns/{id}         # Get campaign details
PUT /api/campaigns/{id}         # Update campaign
DELETE /api/campaigns/{id}      # Delete campaign
```

### Generators

```bash
# Design generator from natural language (Prep Lab)
POST /api/campaigns/{id}/generators/design
{
  "natural_language_spec": "I need a tavern encounter table...",
  "system_name": "D&D 5e"
}

# Execute generator roll (Session Console - <50ms)
POST /api/generators/{id}/roll
{
  "session_id": "uuid",
  "scene_id": "uuid"
}
```

### RAG & Knowledge

```bash
# Upload PDF resource
POST /api/campaigns/{id}/resources/upload
Content-Type: multipart/form-data

# Ask question using RAG
POST /api/campaigns/{id}/ask
{
  "question": "What are the initiative rules?",
  "num_chunks": 5
}

# Generate session packet
POST /api/campaigns/{id}/generate-session-packet
{
  "session_id": "uuid",
  "scene_ids": ["uuid1", "uuid2"]
}
```

See `/home/mrpluvid/preppo/specs/api.md` for complete API specification.

## Architecture

### Performance Targets

| Operation | Target | Strategy |
|-----------|--------|----------|
| Generator Roll | <50ms | Direct DB query, no LLM calls |
| RAG Q&A | <2s | Hybrid search + GPT-4 mini |
| Session State | <100ms | Client-side caching |

### Database Schema

- **pgvector** - 1536-dim embeddings with HNSW index for <100ms vector search
- **Full-text search** - ts_vector for BM25 keyword search
- **Cascading deletes** - Campaign deletion removes all related data
- **Optimized indexes** - All foreign keys, timestamps, status fields

### Caching Strategy

- **Generator definitions:** 1 hour TTL
- **User campaigns:** 10 minutes TTL
- **Resource embeddings:** No expiry (updated on ingestion)
- **JWT blacklist:** TTL = token expiration

### Security

- JWT tokens (HS256, upgradeable to RS256)
- Bcrypt password hashing (12 rounds)
- Rate limiting (Redis-based)
- Input validation (express-validator)
- SQL injection protection (parameterized queries)
- XSS prevention (sanitized inputs)

## Testing

```bash
# Run all tests with coverage
npm test

# Watch mode
npm run test:watch

# Integration tests only
npm run test:integration
```

### Test Structure

```
tests/
├── unit/              # Unit tests for services, utils
│   ├── auth.test.ts
│   ├── generator.test.ts
│   └── rag.test.ts
└── integration/       # API endpoint tests
    ├── auth.test.ts
    ├── campaigns.test.ts
    └── generators.test.ts
```

## Deployment

### Docker

```bash
# Build image
docker build -t preppo-backend .

# Run with docker-compose
docker-compose up
```

### Production

```bash
# Build
npm run build

# Run migrations
NODE_ENV=production npm run migrate

# Start server
NODE_ENV=production npm start
```

### Environment-Specific Config

- **Development:** Debug logging, auto-reload, console output
- **Production:** Info logging, file output, PM2/systemd for process management

## Monitoring & Observability

### Logging

Winston logger with structured JSON output:

- API requests (method, path, status, latency)
- LLM API calls (model, tokens, cost, latency)
- Generator rolls (generator_id, result, latency)
- RAG queries (question, chunks, confidence, latency)
- Security events (failed auth, permission denials)

Log files: `./logs/app.log`, `./logs/error.log`

### Health Check

```bash
GET /health
{
  "status": "healthy",
  "services": {
    "database": "healthy",
    "redis": "healthy"
  },
  "uptime_seconds": 12345
}
```

### Metrics to Track

- Request latency (p50, p95, p99)
- Generator roll latency (target <50ms)
- RAG query latency (target <2s)
- LLM cost per campaign
- Error rates by endpoint
- Database connection pool usage

## Troubleshooting

### Database Connection Issues

```bash
# Test PostgreSQL connection
psql -h localhost -U preppo_user -d preppo_db

# Verify pgvector extension
SELECT * FROM pg_extension WHERE extname = 'vector';
```

### Redis Connection Issues

```bash
# Test Redis connection
redis-cli ping

# Check Redis info
redis-cli info
```

### Migration Errors

```bash
# Check migration status
psql -d preppo_db -c "SELECT * FROM schema_migrations ORDER BY version;"

# Manually rollback migration (if needed)
psql -d preppo_db -c "DELETE FROM schema_migrations WHERE version = 'V00X';"
```

## Contributing

See `IMPLEMENTATION_GUIDE.md` for detailed implementation guidance for remaining services.

## License

MIT License - See LICENSE file for details

## Support

For implementation questions, consult:

- `/home/mrpluvid/preppo/specs/backend.md` - Backend architecture
- `/home/mrpluvid/preppo/specs/database.md` - Database schema
- `/home/mrpluvid/preppo/specs/api.md` - API endpoints
- `/home/mrpluvid/preppo/backend/IMPLEMENTATION_GUIDE.md` - Implementation details
