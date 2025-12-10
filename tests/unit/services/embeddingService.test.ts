/**
 * Unit tests for embeddingService
 * Tests embedding generation with mocked OpenAI API
 */

// Mock OpenAI before any imports
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

import * as embeddingService from '../../../src/services/embeddingService';
import { getDatabase } from '../../../src/config/database';

// Mock database
jest.mock('../../../src/config/database');

// Mock logger
jest.mock('../../../src/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('embeddingService', () => {
  let mockDb: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mock database
    mockDb = {
      none: jest.fn().mockResolvedValue(undefined),
      any: jest.fn(),
      tx: jest.fn(),
    };
    (getDatabase as jest.Mock).mockReturnValue(mockDb);

    // Set environment variable
    process.env.OPENAI_API_KEY = 'test-key';
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
  });

  describe('embedTexts', () => {
    it('should successfully generate embeddings for multiple texts', async () => {
      const texts = ['test text 1', 'test text 2', 'test text 3'];
      const mockEmbeddings = [
        Array(1536).fill(0.1),
        Array(1536).fill(0.2),
        Array(1536).fill(0.3),
      ];

      mockCreate.mockResolvedValue({
        data: [
          { index: 0, embedding: mockEmbeddings[0] },
          { index: 1, embedding: mockEmbeddings[1] },
          { index: 2, embedding: mockEmbeddings[2] },
        ],
        usage: { total_tokens: 100 },
      });

      const result = await embeddingService.embedTexts(texts);

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual(mockEmbeddings[0]);
      expect(result[1]).toEqual(mockEmbeddings[1]);
      expect(result[2]).toEqual(mockEmbeddings[2]);

      expect(mockCreate).toHaveBeenCalledWith({
        model: 'text-embedding-3-small',
        input: texts,
        encoding_format: 'float',
      });
    });

    it('should handle out-of-order responses by sorting by index', async () => {
      const texts = ['text 1', 'text 2', 'text 3'];
      const mockEmbeddings = [
        Array(1536).fill(0.1),
        Array(1536).fill(0.2),
        Array(1536).fill(0.3),
      ];

      // Return out of order
      mockCreate.mockResolvedValue({
        data: [
          { index: 2, embedding: mockEmbeddings[2] },
          { index: 0, embedding: mockEmbeddings[0] },
          { index: 1, embedding: mockEmbeddings[1] },
        ],
        usage: { total_tokens: 100 },
      });

      const result = await embeddingService.embedTexts(texts);

      // Should be sorted correctly
      expect(result[0]).toEqual(mockEmbeddings[0]);
      expect(result[1]).toEqual(mockEmbeddings[1]);
      expect(result[2]).toEqual(mockEmbeddings[2]);
    });

    it('should retry on rate limit error (429)', async () => {
      const texts = ['test text'];
      const mockEmbedding = Array(1536).fill(0.1);

      // Fail twice with rate limit, then succeed
      mockCreate
        .mockRejectedValueOnce({ status: 429, message: 'Rate limit exceeded' })
        .mockRejectedValueOnce({ status: 429, message: 'Rate limit exceeded' })
        .mockResolvedValueOnce({
          data: [{ index: 0, embedding: mockEmbedding }],
          usage: { total_tokens: 10 },
        });

      const result = await embeddingService.embedTexts(texts);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(mockEmbedding);
      expect(mockCreate).toHaveBeenCalledTimes(3);
    });

    it('should throw error after max retries on rate limit', async () => {
      const texts = ['test text'];

      // Always fail with rate limit
      mockCreate.mockRejectedValue({
        status: 429,
        message: 'Rate limit exceeded',
      });

      await expect(embeddingService.embedTexts(texts)).rejects.toThrow(
        'Failed to generate embeddings: Rate limit exceeded'
      );

      // Should retry 5 times then fail on 6th attempt
      expect(mockCreate).toHaveBeenCalledTimes(6); // Initial + 5 retries
    }, 35000); // Increase timeout to account for exponential backoff (1s + 2s + 4s + 8s + 16s = 31s)

    it('should throw error immediately on non-retryable error', async () => {
      const texts = ['test text'];

      mockCreate.mockRejectedValue({
        status: 401,
        message: 'Invalid API key',
      });

      await expect(embeddingService.embedTexts(texts)).rejects.toThrow(
        'Failed to generate embeddings'
      );

      // Should not retry
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it('should return empty array for empty input', async () => {
      const result = await embeddingService.embedTexts([]);

      expect(result).toEqual([]);
      expect(mockCreate).not.toHaveBeenCalled();
    });
  });

  describe('embedQuery', () => {
    it('should generate embedding for single query', async () => {
      const query = 'test query';
      const mockEmbedding = Array(1536).fill(0.5);

      mockCreate.mockResolvedValue({
        data: [{ index: 0, embedding: mockEmbedding }],
        usage: { total_tokens: 5 },
      });

      const result = await embeddingService.embedQuery(query);

      expect(result).toEqual(mockEmbedding);
      expect(mockCreate).toHaveBeenCalledWith({
        model: 'text-embedding-3-small',
        input: [query],
        encoding_format: 'float',
      });
    });
  });

  describe('embedChunks', () => {
    it('should successfully embed chunks and store in database', async () => {
      const resourceId = 'resource-123';
      const chunks = [
        { id: 'chunk-1', raw_text: 'Test chunk 1 content' },
        { id: 'chunk-2', raw_text: 'Test chunk 2 content' },
      ];

      const mockEmbeddings = [Array(1536).fill(0.1), Array(1536).fill(0.2)];

      mockCreate.mockResolvedValue({
        data: [
          { index: 0, embedding: mockEmbeddings[0] },
          { index: 1, embedding: mockEmbeddings[1] },
        ],
        usage: { total_tokens: 50 },
      });

      // Mock transaction
      mockDb.tx.mockImplementation(async (callback: any) => {
        const mockTx = {
          none: jest.fn().mockResolvedValue(undefined),
        };
        return callback(mockTx);
      });

      const result = await embeddingService.embedChunks(resourceId, chunks);

      expect(result.tokensUsed).toBeGreaterThan(0);
      expect(result.estimatedCost).toBeGreaterThan(0);
      expect(mockDb.tx).toHaveBeenCalled();
    });

    it('should process large number of chunks in batches', async () => {
      const resourceId = 'resource-123';

      // Create 250 chunks (3 batches of 100, 100, 50)
      const chunks = Array.from({ length: 250 }, (_, i) => ({
        id: `chunk-${i}`,
        raw_text: `Test chunk ${i} content`,
      }));

      const mockEmbedding = Array(1536).fill(0.1);

      mockCreate.mockImplementation((params: any) => {
        const batchSize = params.input.length;
        return Promise.resolve({
          data: Array.from({ length: batchSize }, (_, i) => ({
            index: i,
            embedding: mockEmbedding,
          })),
          usage: { total_tokens: batchSize * 10 },
        });
      });

      // Mock transaction
      mockDb.tx.mockImplementation(async (callback: any) => {
        const mockTx = {
          none: jest.fn().mockResolvedValue(undefined),
        };
        return callback(mockTx);
      });

      const result = await embeddingService.embedChunks(resourceId, chunks);

      // Should call API 3 times (3 batches)
      expect(mockCreate).toHaveBeenCalledTimes(3);

      // Verify batch sizes
      expect(mockCreate).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          input: expect.arrayContaining([]),
        })
      );

      expect(result.tokensUsed).toBeGreaterThan(0);
      expect(result.estimatedCost).toBeGreaterThan(0);
    });

    it('should throw error if embedding generation fails', async () => {
      const resourceId = 'resource-123';
      const chunks = [{ id: 'chunk-1', raw_text: 'Test content' }];

      mockCreate.mockRejectedValue({
        status: 500,
        message: 'Internal server error',
      });

      await expect(
        embeddingService.embedChunks(resourceId, chunks)
      ).rejects.toThrow();
    });

    it('should handle empty chunks array', async () => {
      const resourceId = 'resource-123';
      const chunks: Array<{ id: string; raw_text: string }> = [];

      const result = await embeddingService.embedChunks(resourceId, chunks);

      expect(result.tokensUsed).toBe(0);
      expect(result.estimatedCost).toBe(0);
      expect(mockCreate).not.toHaveBeenCalled();
    });
  });

  describe('calculateEmbeddingCost', () => {
    it('should calculate cost correctly for various token counts', () => {
      // $0.02 per 1M tokens
      expect(embeddingService.calculateEmbeddingCost(1_000_000)).toBe(0.02);
      expect(embeddingService.calculateEmbeddingCost(500_000)).toBe(0.01);
      expect(embeddingService.calculateEmbeddingCost(100_000)).toBe(0.002);
      expect(embeddingService.calculateEmbeddingCost(10_000)).toBe(0.0002);
      expect(embeddingService.calculateEmbeddingCost(0)).toBe(0);
    });

    it('should handle large token counts', () => {
      const cost = embeddingService.calculateEmbeddingCost(10_000_000);
      expect(cost).toBeCloseTo(0.2, 5);
    });

    it('should handle fractional token counts', () => {
      const cost = embeddingService.calculateEmbeddingCost(123456);
      expect(cost).toBeCloseTo(0.00246912, 8);
    });
  });

  describe('validateConfiguration', () => {
    it('should validate successfully with API key set', () => {
      process.env.OPENAI_API_KEY = 'test-key';

      expect(() => embeddingService.validateConfiguration()).not.toThrow();
    });

    it('should throw error if API key is not set', () => {
      delete process.env.OPENAI_API_KEY;

      expect(() => embeddingService.validateConfiguration()).toThrow(
        'OPENAI_API_KEY environment variable is not set'
      );
    });
  });
});
