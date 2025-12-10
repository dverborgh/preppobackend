/**
 * Unit tests for ragService
 * Tests RAG query generation with mocked OpenAI and database
 */

// Mock OpenAI before any imports
const mockChatCreate = jest.fn();
jest.mock('openai', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: (...args: any[]) => mockChatCreate(...args),
        },
      },
    })),
  };
});

// Mock uuid
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'test-uuid-1234'),
}));

import * as ragService from '../../../src/services/ragService';
import * as embeddingService from '../../../src/services/embeddingService';
import { getDatabase } from '../../../src/config/database';
import { ScoredChunk } from '../../../src/services/ragService';

// Mock database
jest.mock('../../../src/config/database');

// Mock embeddingService
jest.mock('../../../src/services/embeddingService');

// Mock logger
jest.mock('../../../src/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

// Mock campaignService
jest.mock('../../../src/services/campaignService', () => ({
  verifyCampaignOwnership: jest.fn().mockResolvedValue(true),
}));

describe('ragService', () => {
  let mockDb: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mock database
    mockDb = {
      none: jest.fn().mockResolvedValue(undefined),
      one: jest.fn(),
      oneOrNone: jest.fn(),
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

  describe('generateAnswer', () => {
    const mockChunks: ScoredChunk[] = [
      {
        chunkId: 'chunk-1',
        resourceId: 'resource-1',
        content: 'The Fox must answer direct questions truthfully.',
        pageNumber: 2,
        sectionHeading: 'FOX',
        fileName: 'booklet.pdf',
        score: 0.95,
        source: 'hybrid',
      },
      {
        chunkId: 'chunk-2',
        resourceId: 'resource-1',
        content: 'The Fox must accept any gift offered with good intentions.',
        pageNumber: 2,
        sectionHeading: 'FOX',
        fileName: 'booklet.pdf',
        score: 0.88,
        source: 'hybrid',
      },
    ];

    it('should successfully generate an answer with citations', async () => {
      const query = 'What are the unbreakable rules for the Fox?';
      const mockAnswer = `Based on the excerpts, the Fox has the following unbreakable rules:

1. Answer direct questions truthfully [Page 2, FOX]
2. Accept any gift offered with good intentions [Page 2, FOX]

These are binding constraints that the Fox character must follow during gameplay.`;

      mockChatCreate.mockResolvedValue({
        choices: [
          {
            message: {
              content: mockAnswer,
            },
          },
        ],
        usage: {
          prompt_tokens: 250,
          completion_tokens: 75,
        },
      });

      const result = await ragService.generateAnswer(query, mockChunks);

      expect(result.answer).toBe(mockAnswer);
      expect(result.promptTokens).toBe(250);
      expect(result.completionTokens).toBe(75);

      // Verify OpenAI was called with correct parameters
      expect(mockChatCreate).toHaveBeenCalledWith({
        model: 'gpt-4o-mini',
        messages: expect.arrayContaining([
          expect.objectContaining({ role: 'system' }),
          expect.objectContaining({ role: 'user' }),
        ]),
        temperature: 0.3,
        max_tokens: 1000,
      });

      // Verify system prompt contains grounding rules
      const callArgs = mockChatCreate.mock.calls[0][0];
      const systemMessage = callArgs.messages.find((m: any) => m.role === 'system');
      expect(systemMessage.content).toContain('STRICT GROUNDING RULES');
      expect(systemMessage.content).toContain('cite the source');

      // Verify user prompt contains excerpts with citations
      const userMessage = callArgs.messages.find((m: any) => m.role === 'user');
      expect(userMessage.content).toContain('QUESTION:');
      expect(userMessage.content).toContain(query);
      expect(userMessage.content).toContain('[Excerpt 1]');
      expect(userMessage.content).toContain('Page: Page 2');
      expect(userMessage.content).toContain('Section: FOX');
      expect(userMessage.content).toContain(mockChunks[0].content);
    });

    it('should handle empty chunks by refusing to speculate', async () => {
      const query = 'What is the airspeed velocity of an unladen swallow?';
      const emptyChunks: ScoredChunk[] = [];
      const mockAnswer = "I don't have that information in the provided materials.";

      mockChatCreate.mockResolvedValue({
        choices: [
          {
            message: {
              content: mockAnswer,
            },
          },
        ],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 15,
        },
      });

      const result = await ragService.generateAnswer(query, emptyChunks);

      expect(result.answer).toBe(mockAnswer);
      expect(result.promptTokens).toBe(100);
      expect(result.completionTokens).toBe(15);
    });

    it('should include conversation history when provided', async () => {
      const query = 'What about the Piper?';
      const conversationHistory = [
        { role: 'user' as const, content: 'Tell me about the Fox' },
        { role: 'assistant' as const, content: 'The Fox has unbreakable rules...' },
      ];

      mockChatCreate.mockResolvedValue({
        choices: [{ message: { content: 'The Piper plays music...' } }],
        usage: { prompt_tokens: 300, completion_tokens: 50 },
      });

      await ragService.generateAnswer(query, mockChunks, conversationHistory);

      const callArgs = mockChatCreate.mock.calls[0][0];
      expect(callArgs.messages).toHaveLength(4); // system + history (2) + current
      expect(callArgs.messages[1]).toEqual(conversationHistory[0]);
      expect(callArgs.messages[2]).toEqual(conversationHistory[1]);
    });

    it('should limit conversation history to last 2 turns (4 messages)', async () => {
      const query = 'What about abilities?';
      const longHistory = [
        { role: 'user' as const, content: 'Question 1' },
        { role: 'assistant' as const, content: 'Answer 1' },
        { role: 'user' as const, content: 'Question 2' },
        { role: 'assistant' as const, content: 'Answer 2' },
        { role: 'user' as const, content: 'Question 3' },
        { role: 'assistant' as const, content: 'Answer 3' },
      ];

      mockChatCreate.mockResolvedValue({
        choices: [{ message: { content: 'Answer 4' } }],
        usage: { prompt_tokens: 200, completion_tokens: 40 },
      });

      await ragService.generateAnswer(query, mockChunks, longHistory);

      const callArgs = mockChatCreate.mock.calls[0][0];
      // Should have: system + last 4 history messages + current = 6 total
      expect(callArgs.messages).toHaveLength(6);
      expect(callArgs.messages[1].content).toBe('Question 2'); // Last 4 start here
    });

    it('should throw error when OpenAI call fails', async () => {
      const query = 'What is the Fox?';
      mockChatCreate.mockRejectedValue(new Error('OpenAI API error'));

      await expect(ragService.generateAnswer(query, mockChunks)).rejects.toThrow(
        'Failed to generate answer: OpenAI API error'
      );
    });

    it('should handle chunks with missing page numbers and section headings', async () => {
      const chunksWithMissingData: ScoredChunk[] = [
        {
          chunkId: 'chunk-3',
          resourceId: 'resource-2',
          content: 'Some content without metadata.',
          pageNumber: null,
          sectionHeading: null,
          fileName: 'notes.txt',
          score: 0.75,
          source: 'hybrid',
        },
      ];

      mockChatCreate.mockResolvedValue({
        choices: [{ message: { content: 'Answer' } }],
        usage: { prompt_tokens: 150, completion_tokens: 30 },
      });

      await ragService.generateAnswer('Test query', chunksWithMissingData);

      const callArgs = mockChatCreate.mock.calls[0][0];
      const userMessage = callArgs.messages.find((m: any) => m.role === 'user');
      expect(userMessage.content).toContain('Page: Unknown Page');
      expect(userMessage.content).toContain('Section: Untitled');
    });
  });

  describe('query (full RAG pipeline)', () => {
    const userId = 'user-123';
    const campaignId = 'campaign-456';
    const queryText = 'What are the Fox rules?';

    const mockChunks: ScoredChunk[] = [
      {
        chunkId: 'chunk-1',
        resourceId: 'resource-1',
        content: 'The Fox must answer direct questions.',
        pageNumber: 2,
        sectionHeading: 'FOX',
        fileName: 'booklet.pdf',
        score: 0.95,
        source: 'hybrid',
      },
    ];

    beforeEach(() => {
      // Mock database queries for vectorSearch and keywordSearch
      mockDb.any.mockResolvedValue(
        mockChunks.map((chunk) => ({
          chunk_id: chunk.chunkId,
          resource_id: chunk.resourceId,
          content: chunk.content,
          page_number: chunk.pageNumber,
          section_heading: chunk.sectionHeading,
          file_name: chunk.fileName,
          similarity_score: chunk.score,
          relevance_score: chunk.score,
        }))
      );

      // Mock embedQuery
      (embeddingService.embedQuery as jest.Mock).mockResolvedValue(
        Array(1536).fill(0.1)
      );

      // Mock OpenAI chat completion for generateAnswer
      mockChatCreate.mockResolvedValue({
        choices: [
          {
            message: {
              content: 'The Fox must answer direct questions truthfully [Page 2, FOX].',
            },
          },
        ],
        usage: {
          prompt_tokens: 200,
          completion_tokens: 50,
        },
      });

      // Mock logQuery (db.one call)
      mockDb.one.mockResolvedValue({ id: 'query-log-id-789' });
    });

    it('should execute full RAG pipeline and return response', async () => {
      const result = await ragService.query(mockDb, userId, campaignId, queryText);

      expect(result.queryId).toBe('query-log-id-789');
      expect(result.answer).toContain('Fox must answer');
      expect(result.sources).toHaveLength(1);
      expect(result.sources[0]).toEqual({
        chunkId: 'chunk-1',
        resourceId: 'resource-1',
        fileName: 'booklet.pdf',
        pageNumber: 2,
        sectionHeading: 'FOX',
        contentPreview: 'The Fox must answer direct questions.',
        similarityScore: expect.any(Number), // RRF score, not the original score
        rank: 1,
      });
      expect(result.metadata).toEqual({
        model: 'gpt-4o-mini',
        promptTokens: 200,
        completionTokens: 50,
        latencyMs: expect.any(Number),
        searchLatencyMs: expect.any(Number),
        llmLatencyMs: expect.any(Number),
        chunksRetrieved: 1,
        conversationId: expect.any(String),
      });

      // Verify query was logged with UUID array type cast
      expect(mockDb.one).toHaveBeenCalledWith(
        expect.stringContaining('$4::uuid[]'),
        expect.arrayContaining([
          campaignId,
          userId,
          queryText,
          ['chunk-1'],
          expect.any(Array), // Scores array (RRF scores, not original)
          expect.stringContaining('Fox must answer'),
          'gpt-4o-mini',
          200,
          50,
        ])
      );
    });

    it('should use provided conversation ID', async () => {
      const conversationId = 'existing-conversation-id';

      const result = await ragService.query(mockDb, userId, campaignId, queryText, {
        conversationId,
      });

      expect(result.metadata.conversationId).toBe(conversationId);

      // Verify logged with correct conversation ID
      expect(mockDb.one).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([conversationId])
      );
    });

    it('should respect topK option', async () => {
      await ragService.query(mockDb, userId, campaignId, queryText, { topK: 5 });

      // Verify query executed successfully
      expect(mockDb.one).toHaveBeenCalled();
    });

    it('should filter by resource IDs when provided', async () => {
      const resourceIds = ['resource-1', 'resource-2'];

      await ragService.query(mockDb, userId, campaignId, queryText, { resourceIds });

      // Verify query executed successfully
      expect(mockDb.one).toHaveBeenCalled();
    });

    it('should truncate content preview to 200 characters', async () => {
      const longContent = 'A'.repeat(500);

      // Mock database to return long content
      mockDb.any.mockResolvedValue([
        {
          chunk_id: 'chunk-1',
          resource_id: 'resource-1',
          content: longContent,
          page_number: 2,
          section_heading: 'FOX',
          file_name: 'booklet.pdf',
          similarity_score: 0.95,
          relevance_score: 0.95,
        },
      ]);

      const result = await ragService.query(mockDb, userId, campaignId, queryText);

      expect(result.sources[0].contentPreview).toHaveLength(200);
      expect(result.sources[0].contentPreview).toBe('A'.repeat(200));
    });

    it('should track performance metrics accurately', async () => {
      const result = await ragService.query(mockDb, userId, campaignId, queryText);

      expect(result.metadata.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.metadata.searchLatencyMs).toBeGreaterThanOrEqual(0);
      expect(result.metadata.llmLatencyMs).toBeGreaterThanOrEqual(0);
      expect(result.metadata.latencyMs).toBeGreaterThanOrEqual(
        result.metadata.searchLatencyMs + result.metadata.llmLatencyMs
      );
    });

    it('should return early when no chunks are found without calling LLM', async () => {
      // Mock empty results from both vector and keyword search
      mockDb.any.mockResolvedValue([]);

      const result = await ragService.query(mockDb, userId, campaignId, 'nonexistent query');

      // Verify early return response structure
      expect(result.queryId).toBeDefined();
      expect(result.answer).toBe(
        "I don't have any information about that in your uploaded materials. You may need to upload relevant resources first, or try rephrasing your question."
      );
      expect(result.sources).toEqual([]);

      // Verify metadata shows no LLM call
      expect(result.metadata).toEqual({
        model: 'none',
        promptTokens: 0,
        completionTokens: 0,
        latencyMs: expect.any(Number),
        searchLatencyMs: expect.any(Number),
        llmLatencyMs: 0,
        chunksRetrieved: 0,
        conversationId: expect.any(String),
      });

      // Verify OpenAI was NOT called
      expect(mockChatCreate).not.toHaveBeenCalled();

      // Verify query was NOT logged to database (no db.one call for logging)
      expect(mockDb.one).not.toHaveBeenCalled();
    });

    it('should use provided conversationId even when returning early with no chunks', async () => {
      const conversationId = 'existing-conversation-id';
      mockDb.any.mockResolvedValue([]);

      const result = await ragService.query(mockDb, userId, campaignId, 'nonexistent query', {
        conversationId,
      });

      expect(result.metadata.conversationId).toBe(conversationId);
      expect(mockChatCreate).not.toHaveBeenCalled();
    });
  });

  describe('vectorSearch error handling', () => {
    it('should handle database errors gracefully', async () => {
      const campaignId = 'campaign-123';
      const embedding = Array(1536).fill(0.1);

      mockDb.any.mockRejectedValue(new Error('Database connection failed'));

      await expect(
        ragService.vectorSearch(mockDb, campaignId, embedding)
      ).rejects.toThrow('Database connection failed');
    });

    it('should apply resource ID filters correctly', async () => {
      const campaignId = 'campaign-123';
      const embedding = Array(1536).fill(0.1);
      const filters = { resourceIds: ['resource-1', 'resource-2'] };

      mockDb.any.mockResolvedValue([]);

      await ragService.vectorSearch(mockDb, campaignId, embedding, 10, filters);

      expect(mockDb.any).toHaveBeenCalledWith(
        expect.stringContaining('r.id = ANY'),
        expect.any(Array)
      );
    });

    it('should apply page number filters correctly', async () => {
      const campaignId = 'campaign-123';
      const embedding = Array(1536).fill(0.1);
      const filters = { pageNumbers: [1, 2, 3] };

      mockDb.any.mockResolvedValue([]);

      await ragService.vectorSearch(mockDb, campaignId, embedding, 10, filters);

      expect(mockDb.any).toHaveBeenCalledWith(
        expect.stringContaining('page_number = ANY'),
        expect.any(Array)
      );
    });

    it('should apply tag filters correctly', async () => {
      const campaignId = 'campaign-123';
      const embedding = Array(1536).fill(0.1);
      const filters = { tags: ['rules', 'combat'] };

      mockDb.any.mockResolvedValue([]);

      await ragService.vectorSearch(mockDb, campaignId, embedding, 10, filters);

      expect(mockDb.any).toHaveBeenCalledWith(
        expect.stringContaining('rc.tags &&'),
        expect.any(Array)
      );
    });
  });

  describe('keywordSearch error handling', () => {
    it('should handle database errors gracefully', async () => {
      const campaignId = 'campaign-123';
      const query = 'test query';

      mockDb.any.mockRejectedValue(new Error('Full-text search failed'));

      await expect(
        ragService.keywordSearch(mockDb, campaignId, query)
      ).rejects.toThrow('Full-text search failed');
    });

    it('should apply resource ID filters correctly', async () => {
      const campaignId = 'campaign-123';
      const query = 'test query';
      const filters = { resourceIds: ['resource-1', 'resource-2'] };

      mockDb.any.mockResolvedValue([]);

      await ragService.keywordSearch(mockDb, campaignId, query, 10, filters);

      expect(mockDb.any).toHaveBeenCalledWith(
        expect.stringContaining('r.id = ANY'),
        expect.arrayContaining([query, campaignId, filters.resourceIds, 10])
      );
    });

    it('should apply page number filters correctly', async () => {
      const campaignId = 'campaign-123';
      const query = 'test query';
      const filters = { pageNumbers: [5, 10] };

      mockDb.any.mockResolvedValue([]);

      await ragService.keywordSearch(mockDb, campaignId, query, 10, filters);

      expect(mockDb.any).toHaveBeenCalledWith(
        expect.stringContaining('page_number = ANY'),
        expect.arrayContaining([query, campaignId, filters.pageNumbers, 10])
      );
    });

    it('should apply tag filters correctly', async () => {
      const campaignId = 'campaign-123';
      const query = 'test query';
      const filters = { tags: ['lore', 'magic'] };

      mockDb.any.mockResolvedValue([]);

      await ragService.keywordSearch(mockDb, campaignId, query, 10, filters);

      expect(mockDb.any).toHaveBeenCalledWith(
        expect.stringContaining('rc.tags &&'),
        expect.arrayContaining([query, campaignId, filters.tags, 10])
      );
    });
  });

  describe('hybridSearch error handling', () => {
    it('should handle errors when vectorSearch fails', async () => {
      const campaignId = 'campaign-123';
      const query = 'test query';

      (embeddingService.embedQuery as jest.Mock).mockResolvedValue(Array(1536).fill(0.1));
      mockDb.any.mockRejectedValueOnce(new Error('Vector search failed'));

      await expect(
        ragService.hybridSearch(mockDb, campaignId, query)
      ).rejects.toThrow('Vector search failed');
    });

    it('should handle errors when keywordSearch fails', async () => {
      const campaignId = 'campaign-123';
      const query = 'test query';

      (embeddingService.embedQuery as jest.Mock).mockResolvedValue(Array(1536).fill(0.1));
      mockDb.any
        .mockResolvedValueOnce([]) // vectorSearch succeeds with empty results
        .mockRejectedValueOnce(new Error('Keyword search failed')); // keywordSearch fails

      await expect(
        ragService.hybridSearch(mockDb, campaignId, query)
      ).rejects.toThrow('Keyword search failed');
    });

    it('should handle embedding service errors', async () => {
      const campaignId = 'campaign-123';
      const query = 'test query';

      (embeddingService.embedQuery as jest.Mock).mockRejectedValue(
        new Error('Embedding service unavailable')
      );

      await expect(
        ragService.hybridSearch(mockDb, campaignId, query)
      ).rejects.toThrow('Embedding service unavailable');
    });
  });

  describe('logQuery error handling', () => {
    it('should handle database errors when logging query', async () => {
      const userId = 'user-123';
      const campaignId = 'campaign-123';
      const queryText = 'test query';

      const mockChunks = [
        {
          chunk_id: 'chunk-1',
          resource_id: 'resource-1',
          content: 'Test content',
          page_number: 1,
          section_heading: 'Test',
          file_name: 'test.pdf',
          similarity_score: 0.9,
          relevance_score: 0.9,
        },
      ];

      (embeddingService.embedQuery as jest.Mock).mockResolvedValue(Array(1536).fill(0.1));
      // Return non-empty chunks so we actually reach the logging step
      mockDb.any.mockResolvedValue(mockChunks);
      mockDb.one.mockRejectedValue(new Error('Failed to log query'));

      mockChatCreate.mockResolvedValue({
        choices: [{ message: { content: 'Answer' } }],
        usage: { prompt_tokens: 100, completion_tokens: 20 },
      });

      await expect(
        ragService.query(mockDb, userId, campaignId, queryText)
      ).rejects.toThrow('Failed to log query');
    });

    it('should correctly log query with UUID array type cast (NEW-3 fix)', async () => {
      const userId = 'user-123';
      const campaignId = 'campaign-456';
      const queryText = 'What are the Fox rules?';

      const mockChunks = [
        {
          chunk_id: '591d7264-f021-455a-8368-b69654313349',
          resource_id: 'b65c7428-ae82-4941-a2ce-d40b593bb0ac',
          content: 'The Fox must answer direct questions.',
          page_number: 2,
          section_heading: 'FOX',
          file_name: 'booklet.pdf',
          similarity_score: 0.95,
          relevance_score: 0.95,
        },
        {
          chunk_id: '7f3e4b2a-9c1d-4e5f-8a7b-6c5d4e3f2a1b',
          resource_id: 'b65c7428-ae82-4941-a2ce-d40b593bb0ac',
          content: 'The Fox must accept gifts.',
          page_number: 2,
          section_heading: 'FOX',
          file_name: 'booklet.pdf',
          similarity_score: 0.88,
          relevance_score: 0.88,
        },
      ];

      (embeddingService.embedQuery as jest.Mock).mockResolvedValue(Array(1536).fill(0.1));
      mockDb.any.mockResolvedValue(mockChunks);
      mockDb.one.mockResolvedValue({ id: 'query-log-id-789' });

      mockChatCreate.mockResolvedValue({
        choices: [{ message: { content: 'The Fox has rules...' } }],
        usage: { prompt_tokens: 200, completion_tokens: 50 },
      });

      await ragService.query(mockDb, userId, campaignId, queryText);

      // Verify the SQL query contains the ::uuid[] type cast to fix NEW-3
      expect(mockDb.one).toHaveBeenCalledWith(
        expect.stringContaining('$4::uuid[]'),
        expect.any(Array)
      );

      // Verify the UUID array is passed correctly as string array
      const callArgs = mockDb.one.mock.calls[0][1];
      const retrievedChunkIds = callArgs[3];
      expect(retrievedChunkIds).toEqual([
        '591d7264-f021-455a-8368-b69654313349',
        '7f3e4b2a-9c1d-4e5f-8a7b-6c5d4e3f2a1b',
      ]);

      // Verify each chunk ID is a valid UUID string
      retrievedChunkIds.forEach((id: string) => {
        expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      });
    });
  });
});
