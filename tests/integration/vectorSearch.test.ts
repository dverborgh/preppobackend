/**
 * Integration tests for vector search
 * Tests end-to-end flow: upload → process → embed → search
 */

import { initDatabase, closeDatabase, toVector } from '../../src/config/database';
import * as embeddingService from '../../src/services/embeddingService';
import * as ragService from '../../src/services/ragService';
import { v4 as uuidv4 } from 'uuid';

// Mock OpenAI to avoid real API calls
const mockCreate = jest.fn();
jest.mock('openai', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      embeddings: {
        create: (...args: any[]) => mockCreate(...args),
      },
    })),
  };
});

describe('Vector Search Integration Tests', () => {
  let db: any;
  let userId: string;
  let campaignId: string;
  let resourceId: string;

  // Mock embedding vector (1536 dimensions)
  const createMockEmbedding = (seed: number = 0.5): number[] => {
    return Array.from({ length: 1536 }, (_, i) => seed + i * 0.0001);
  };

  beforeAll(async () => {
    // Set API key before initializing database
    process.env.OPENAI_API_KEY = 'test-key';

    // Initialize database connection
    try {
      db = await initDatabase();
    } catch (error) {
      console.log('Skipping integration tests: Database not available', error);
      return;
    }
  });

  afterAll(async () => {
    await closeDatabase();
  });

  beforeEach(async () => {
    if (!db) {
      return;
    }

    // Clear test data (order matters due to foreign key constraints)
    await db.none('DELETE FROM resource_chunks WHERE 1=1');
    await db.none('DELETE FROM resources WHERE 1=1');
    await db.none('DELETE FROM generator_rolls WHERE 1=1'); // Delete before sessions
    await db.none('DELETE FROM sessions WHERE 1=1');
    await db.none('DELETE FROM campaigns WHERE 1=1');
    await db.none('DELETE FROM users WHERE 1=1');

    // Create test user
    userId = uuidv4();
    await db.none(
      `INSERT INTO users (id, email, password_hash, name)
       VALUES ($1, $2, $3, $4)`,
      [userId, 'test@example.com', 'hashedpassword', 'Test User']
    );

    // Create test campaign
    campaignId = uuidv4();
    await db.none(
      `INSERT INTO campaigns (id, user_id, name, system_name)
       VALUES ($1, $2, $3, $4)`,
      [campaignId, userId, 'Test Campaign', 'D&D 5e']
    );

    // Create test resource
    resourceId = uuidv4();
    await db.none(
      `INSERT INTO resources (id, campaign_id, original_filename, file_url,
                              file_size_bytes, content_type, ingestion_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        resourceId,
        campaignId,
        'test.pdf',
        'test/path/test.pdf',
        1000,
        'application/pdf',
        'completed',
      ]
    );

    // Reset mock
    jest.clearAllMocks();
  });

  describe('embedChunks', () => {
    it('should generate and store embeddings for chunks', async () => {
      if (!db) return;

      // Create test chunks
      const chunk1Id = uuidv4();
      const chunk2Id = uuidv4();
      const chunk3Id = uuidv4();

      await db.none(
        `INSERT INTO resource_chunks (id, resource_id, chunk_index, raw_text, token_count)
         VALUES ($1, $2, $3, $4, $5)`,
        [chunk1Id, resourceId, 0, 'The wizard casts a fireball spell', 100]
      );
      await db.none(
        `INSERT INTO resource_chunks (id, resource_id, chunk_index, raw_text, token_count)
         VALUES ($1, $2, $3, $4, $5)`,
        [chunk2Id, resourceId, 1, 'The warrior attacks with a sword', 100]
      );
      await db.none(
        `INSERT INTO resource_chunks (id, resource_id, chunk_index, raw_text, token_count)
         VALUES ($1, $2, $3, $4, $5)`,
        [chunk3Id, resourceId, 2, 'The rogue sneaks through the shadows', 100]
      );

      // Mock OpenAI embeddings
      mockCreate.mockResolvedValue({
        data: [
          { index: 0, embedding: createMockEmbedding(0.1) },
          { index: 1, embedding: createMockEmbedding(0.2) },
          { index: 2, embedding: createMockEmbedding(0.3) },
        ],
        usage: { total_tokens: 300 },
      });

      // Get chunks
      const chunks = await db.any(
        'SELECT id, raw_text FROM resource_chunks WHERE resource_id = $1 ORDER BY chunk_index',
        [resourceId]
      );

      // Generate embeddings
      const result = await embeddingService.embedChunks(resourceId, chunks);

      expect(result.tokensUsed).toBeGreaterThan(0);
      expect(result.estimatedCost).toBeGreaterThan(0);

      // Verify embeddings were stored
      const chunksWithEmbeddings = await db.any(
        'SELECT id, embedding FROM resource_chunks WHERE resource_id = $1 AND embedding IS NOT NULL',
        [resourceId]
      );

      expect(chunksWithEmbeddings).toHaveLength(3);
    });
  });

  describe('vectorSearch', () => {
    it('should find relevant chunks using vector similarity', async () => {
      if (!db) return;

      // Create chunks with embeddings
      const chunks = [
        { text: 'Magic spells and wizardry', embedding: createMockEmbedding(0.5) },
        { text: 'Sword fighting and combat', embedding: createMockEmbedding(0.2) },
        { text: 'Stealth and sneaking', embedding: createMockEmbedding(0.8) },
      ];

      for (let i = 0; i < chunks.length; i++) {
        const chunkId = uuidv4();
        await db.none(
          `INSERT INTO resource_chunks
           (id, resource_id, chunk_index, raw_text, token_count, embedding, page_number)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            chunkId,
            resourceId,
            i,
            chunks[i].text,
            50,
            toVector(chunks[i].embedding),
            i + 1,
          ]
        );
      }

      // Search with query embedding similar to first chunk
      const queryEmbedding = createMockEmbedding(0.52); // Close to 0.5

      const results = await ragService.vectorSearch(
        db,
        campaignId,
        queryEmbedding,
        3
      );

      expect(results).toHaveLength(3);

      // First result should be most similar (chunk with 0.5 embedding)
      expect(results[0].content).toBe('Magic spells and wizardry');
      expect(results[0].score).toBeGreaterThan(0.9); // High similarity
      expect(results[0].source).toBe('vector');
      expect(results[0].pageNumber).toBe(1);
    });

    it('should respect campaign isolation', async () => {
      if (!db) return;

      // Create another campaign and resource
      const otherCampaignId = uuidv4();
      const otherResourceId = uuidv4();

      await db.none(
        `INSERT INTO campaigns (id, user_id, name, system_name)
         VALUES ($1, $2, $3, $4)`,
        [otherCampaignId, userId, 'Other Campaign', 'Pathfinder']
      );

      await db.none(
        `INSERT INTO resources (id, campaign_id, original_filename, file_url,
                                file_size_bytes, content_type, ingestion_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          otherResourceId,
          otherCampaignId,
          'other.pdf',
          'test/path/other.pdf',
          1000,
          'application/pdf',
          'completed',
        ]
      );

      // Add chunk to original campaign
      await db.none(
        `INSERT INTO resource_chunks
         (id, resource_id, chunk_index, raw_text, token_count, embedding)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          uuidv4(),
          resourceId,
          0,
          'Campaign 1 content',
          50,
          toVector(createMockEmbedding(0.5)),
        ]
      );

      // Add chunk to other campaign
      await db.none(
        `INSERT INTO resource_chunks
         (id, resource_id, chunk_index, raw_text, token_count, embedding)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          uuidv4(),
          otherResourceId,
          0,
          'Campaign 2 content',
          50,
          toVector(createMockEmbedding(0.5)),
        ]
      );

      // Search in original campaign
      const queryEmbedding = createMockEmbedding(0.5);
      const results = await ragService.vectorSearch(
        db,
        campaignId,
        queryEmbedding,
        10
      );

      // Should only find chunk from original campaign
      expect(results).toHaveLength(1);
      expect(results[0].content).toBe('Campaign 1 content');
    });

    it('should filter by resource IDs', async () => {
      if (!db) return;

      // Create two resources in the same campaign
      const resource2Id = uuidv4();
      await db.none(
        `INSERT INTO resources (id, campaign_id, original_filename, file_url,
                                file_size_bytes, content_type, ingestion_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          resource2Id,
          campaignId,
          'test2.pdf',
          'test/path/test2.pdf',
          1000,
          'application/pdf',
          'completed',
        ]
      );

      // Add chunks to both resources
      await db.none(
        `INSERT INTO resource_chunks
         (id, resource_id, chunk_index, raw_text, token_count, embedding)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          uuidv4(),
          resourceId,
          0,
          'Resource 1 content',
          50,
          toVector(createMockEmbedding(0.5)),
        ]
      );

      await db.none(
        `INSERT INTO resource_chunks
         (id, resource_id, chunk_index, raw_text, token_count, embedding)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          uuidv4(),
          resource2Id,
          0,
          'Resource 2 content',
          50,
          toVector(createMockEmbedding(0.5)),
        ]
      );

      // Search with resource filter
      const queryEmbedding = createMockEmbedding(0.5);
      const results = await ragService.vectorSearch(
        db,
        campaignId,
        queryEmbedding,
        10,
        { resourceIds: [resourceId] }
      );

      // Should only find chunk from filtered resource
      expect(results).toHaveLength(1);
      expect(results[0].content).toBe('Resource 1 content');
    });

    it('should return top K results ordered by similarity', async () => {
      if (!db) return;

      // Create 10 chunks with varying embeddings
      for (let i = 0; i < 10; i++) {
        await db.none(
          `INSERT INTO resource_chunks
           (id, resource_id, chunk_index, raw_text, token_count, embedding)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            uuidv4(),
            resourceId,
            i,
            `Chunk ${i}`,
            50,
            toVector(createMockEmbedding(i * 0.1)),
          ]
        );
      }

      // Search for top 5
      const queryEmbedding = createMockEmbedding(0.52); // Close to chunk 5
      const results = await ragService.vectorSearch(db, campaignId, queryEmbedding, 5);

      expect(results).toHaveLength(5);

      // Results should be ordered by similarity (descending)
      for (let i = 0; i < results.length - 1; i++) {
        expect(results[i].score).toBeGreaterThanOrEqual(results[i + 1].score);
      }
    });
  });

  describe('searchChunks', () => {
    it('should perform hybrid search combining vector and keyword', async () => {
      if (!db) return;

      // Create chunks with embeddings
      await db.none(
        `INSERT INTO resource_chunks
         (id, resource_id, chunk_index, raw_text, token_count, embedding)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          uuidv4(),
          resourceId,
          0,
          'The wizard casts a powerful fireball spell',
          100,
          toVector(createMockEmbedding(0.5)),
        ]
      );

      await db.none(
        `INSERT INTO resource_chunks
         (id, resource_id, chunk_index, raw_text, token_count, embedding)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          uuidv4(),
          resourceId,
          1,
          'The warrior charges with his sword drawn',
          100,
          toVector(createMockEmbedding(0.2)),
        ]
      );

      // Mock query embedding
      mockCreate.mockResolvedValue({
        data: [{ index: 0, embedding: createMockEmbedding(0.5) }],
        usage: { total_tokens: 10 },
      });

      // Search for "wizard"
      const results = await ragService.searchChunks(
        db,
        userId,
        campaignId,
        'wizard spell',
        { topK: 2, mode: 'hybrid' }
      );

      expect(results.length).toBeGreaterThan(0);

      // Should find wizard chunk
      const wizardChunk = results.find((r) => r.content.includes('wizard'));
      expect(wizardChunk).toBeDefined();
      expect(wizardChunk?.source).toBe('hybrid');
    });

    it('should enforce campaign ownership', async () => {
      if (!db) return;

      // Create another user
      const otherUserId = uuidv4();
      await db.none(
        `INSERT INTO users (id, email, password_hash, name)
         VALUES ($1, $2, $3, $4)`,
        [otherUserId, 'other@example.com', 'hashedpassword', 'Other User']
      );

      // Mock embedding
      mockCreate.mockResolvedValue({
        data: [{ index: 0, embedding: createMockEmbedding(0.5) }],
        usage: { total_tokens: 10 },
      });

      // Try to search campaign owned by different user
      await expect(
        ragService.searchChunks(db, otherUserId, campaignId, 'test query')
      ).rejects.toThrow();
    });
  });
});
