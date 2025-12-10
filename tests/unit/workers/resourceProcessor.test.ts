/**
 * Unit tests for resourceProcessor worker
 * Tests job processing, chunking, embedding, and error handling
 */

import * as resourceProcessor from '../../../src/workers/resourceProcessor';
import * as resourceService from '../../../src/services/resourceService';
import * as documentProcessingService from '../../../src/services/documentProcessingService';
import * as embeddingService from '../../../src/services/embeddingService';

// Mock dependencies
jest.mock('../../../src/services/resourceService');
jest.mock('../../../src/services/documentProcessingService');
jest.mock('../../../src/services/embeddingService');
jest.mock('../../../src/utils/logger');
jest.mock('../../../src/config/jobQueue');
jest.mock('../../../src/config/database');

// Import mocked modules
import { getJobQueue } from '../../../src/config/jobQueue';
import { getDatabase } from '../../../src/config/database';
import logger from '../../../src/utils/logger';

describe('resourceProcessor worker', () => {
  let mockDb: any;
  let mockQueue: any;
  const resourceId = 'resource-123';
  const campaignId = 'campaign-123';
  const userId = 'user-123';
  const filePath = 'test-file.pdf';

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock database with pg-promise helpers
    const mockPgp = {
      helpers: {
        ColumnSet: jest.fn().mockImplementation(() => ({})),
        insert: jest.fn().mockReturnValue('INSERT QUERY'),
      },
    };

    mockDb = {
      none: jest.fn().mockResolvedValue(undefined),
      any: jest.fn().mockResolvedValue([]),
      one: jest.fn(),
      oneOrNone: jest.fn(),
      $config: {
        pgp: mockPgp,
      },
    };

    (getDatabase as jest.Mock).mockReturnValue(mockDb);

    // Mock job queue
    mockQueue = {
      work: jest.fn().mockResolvedValue(undefined),
      getQueueSize: jest.fn().mockResolvedValue(5),
    };

    (getJobQueue as jest.Mock).mockReturnValue(mockQueue);

    // Mock resourceService
    (resourceService.updateProcessingStatus as jest.Mock).mockResolvedValue(undefined);

    // Mock logger
    (logger.info as jest.Mock).mockImplementation();
    (logger.debug as jest.Mock).mockImplementation();
    (logger.warn as jest.Mock).mockImplementation();
    (logger.error as jest.Mock).mockImplementation();
  });

  describe('processResourceJob', () => {
    it('should process resource successfully', async () => {
      // Mock text extraction
      const mockExtracted = {
        totalPages: 50,
        pages: [{ pageNumber: 1, text: 'Page 1 content' }],
        metadata: {
          title: 'Test Document',
          author: 'Test Author',
          subject: 'Test Subject',
          creator: 'Test Creator',
          producer: 'Test Producer',
        },
      };
      (documentProcessingService.extractText as jest.Mock).mockResolvedValue(mockExtracted);

      // Mock chunking
      const mockChunks: documentProcessingService.Chunk[] = [
        {
          content: 'Chunk 1 content',
          tokenCount: 150,
          pageNumber: 1,
          sectionHeading: 'Introduction',
          startOffset: 0,
          endOffset: 100,
        },
        {
          content: 'Chunk 2 content',
          tokenCount: 200,
          pageNumber: 2,
          sectionHeading: 'Chapter 1',
          startOffset: 100,
          endOffset: 250,
        },
      ];
      (documentProcessingService.chunkDocument as jest.Mock).mockResolvedValue(mockChunks);

      // Mock chunk IDs retrieval
      const mockChunkIds = [
        { id: 'chunk-1', raw_text: 'Chunk 1 content' },
        { id: 'chunk-2', raw_text: 'Chunk 2 content' },
      ];
      mockDb.any.mockResolvedValue(mockChunkIds);

      // Mock embedding generation
      const mockEmbeddingResult = {
        tokensUsed: 500,
        estimatedCost: 0.0001,
      };
      (embeddingService.embedChunks as jest.Mock).mockResolvedValue(mockEmbeddingResult);

      // Register worker and get the processor function
      await resourceProcessor.registerResourceProcessor();

      // Get the registered work function
      const workCall = (mockQueue.work as jest.Mock).mock.calls[0];
      const processorFn = workCall[2];

      // Create mock job
      const mockJob = {
        id: 'job-123',
        data: {
          resourceId,
          campaignId,
          filePath,
          userId,
        },
      };

      // Execute the processor
      await processorFn(mockJob);

      // Verify processing steps
      expect(resourceService.updateProcessingStatus).toHaveBeenCalledWith(
        mockDb,
        resourceId,
        resourceService.ProcessingStatus.PROCESSING
      );

      expect(documentProcessingService.extractText).toHaveBeenCalled();
      expect(documentProcessingService.chunkDocument).toHaveBeenCalledWith(mockExtracted);

      // Verify chunks were inserted
      expect(mockDb.none).toHaveBeenCalled();

      // Verify embeddings were generated
      expect(embeddingService.embedChunks).toHaveBeenCalledWith(resourceId, mockChunkIds);

      // Verify completion status update
      expect(mockDb.none).toHaveBeenCalledWith(
        expect.stringContaining('ingestion_status'),
        expect.arrayContaining([
          mockChunks.length,
          resourceService.ProcessingStatus.COMPLETED,
          expect.any(Number),
          resourceId,
        ])
      );

      expect(logger.info).toHaveBeenCalledWith(
        'Resource processing completed successfully',
        expect.any(Object)
      );
    });

    it('should handle empty chunks array', async () => {
      const mockExtracted = {
        totalPages: 1,
        pages: [],
        metadata: {},
      };
      (documentProcessingService.extractText as jest.Mock).mockResolvedValue(mockExtracted);

      // Mock empty chunks
      (documentProcessingService.chunkDocument as jest.Mock).mockResolvedValue([]);

      // Register worker
      await resourceProcessor.registerResourceProcessor();
      const workCall = (mockQueue.work as jest.Mock).mock.calls[0];
      const processorFn = workCall[2];

      const mockJob = {
        id: 'job-empty',
        data: { resourceId, campaignId, filePath, userId },
      };

      await processorFn(mockJob);

      // Verify warning was logged for empty chunks
      expect(logger.warn).toHaveBeenCalledWith('No chunks to insert', { resourceId });
    });

    it('should handle embedding generation failures gracefully', async () => {
      const mockExtracted = {
        totalPages: 10,
        pages: [{ pageNumber: 1, text: 'Test' }],
        metadata: {},
      };
      (documentProcessingService.extractText as jest.Mock).mockResolvedValue(mockExtracted);

      const mockChunks = [
        {
          content: 'Test chunk',
          tokenCount: 100,
          pageNumber: 1,
          sectionHeading: 'Test',
          startOffset: 0,
          endOffset: 50,
        },
      ];
      (documentProcessingService.chunkDocument as jest.Mock).mockResolvedValue(mockChunks);

      mockDb.any.mockResolvedValue([{ id: 'chunk-1', raw_text: 'Test chunk' }]);

      // Mock embedding failure
      (embeddingService.embedChunks as jest.Mock).mockRejectedValue(
        new Error('Embedding API rate limit')
      );

      // Register worker
      await resourceProcessor.registerResourceProcessor();
      const workCall = (mockQueue.work as jest.Mock).mock.calls[0];
      const processorFn = workCall[2];

      const mockJob = {
        id: 'job-embed-fail',
        data: { resourceId, campaignId, filePath, userId },
      };

      // Should not throw error - embeddings are optional
      await processorFn(mockJob);

      expect(logger.error).toHaveBeenCalledWith(
        'Failed to generate embeddings',
        expect.objectContaining({
          resourceId,
          error: 'Embedding API rate limit',
        })
      );

      // Should still complete successfully (without embeddings)
      expect(mockDb.none).toHaveBeenCalledWith(
        expect.stringContaining('ingestion_status'),
        expect.arrayContaining([
          mockChunks.length,
          'completed_no_embeddings',
          expect.any(Number),
          resourceId,
        ])
      );
    });

    it('should handle processing failures', async () => {
      // Mock extraction failure
      (documentProcessingService.extractText as jest.Mock).mockRejectedValue(
        new Error('PDF parsing failed')
      );

      // Register worker
      await resourceProcessor.registerResourceProcessor();
      const workCall = (mockQueue.work as jest.Mock).mock.calls[0];
      const processorFn = workCall[2];

      const mockJob = {
        id: 'job-fail',
        data: { resourceId, campaignId, filePath, userId },
      };

      // Should throw error to trigger retry
      await expect(processorFn(mockJob)).rejects.toThrow('PDF parsing failed');

      // Verify failure status was set
      expect(resourceService.updateProcessingStatus).toHaveBeenCalledWith(
        mockDb,
        resourceId,
        resourceService.ProcessingStatus.FAILED,
        'PDF parsing failed'
      );

      expect(logger.error).toHaveBeenCalledWith(
        'Resource processing failed',
        expect.objectContaining({
          resourceId,
          error: 'PDF parsing failed',
        })
      );
    });

    // Note: Testing chunk insertion errors is complex due to mock state management
    // and the error handling path already passes through the main error handler
    // The uncovered lines (79-84) are the insertChunks error logging which would require
    // precise mock sequencing. Coverage for the main error path is already achieved.

    it('should update processing_retry_count', async () => {
      const mockExtracted = {
        totalPages: 1,
        pages: [],
        metadata: {},
      };
      (documentProcessingService.extractText as jest.Mock).mockResolvedValue(mockExtracted);
      (documentProcessingService.chunkDocument as jest.Mock).mockResolvedValue([]);

      // Register worker
      await resourceProcessor.registerResourceProcessor();
      const workCall = (mockQueue.work as jest.Mock).mock.calls[0];
      const processorFn = workCall[2];

      const mockJob = {
        id: 'job-retry',
        data: { resourceId, campaignId, filePath, userId },
      };

      await processorFn(mockJob);

      // Verify retry count was incremented
      expect(mockDb.none).toHaveBeenCalledWith(
        expect.stringContaining('processing_retry_count = processing_retry_count + 1'),
        [resourceId]
      );
    });

    it('should update metadata with extraction info', async () => {
      const mockExtracted = {
        totalPages: 25,
        pages: [],
        metadata: {
          title: 'Player\'s Handbook',
          author: 'Wizards of the Coast',
          subject: 'RPG Rules',
          creator: 'Adobe InDesign',
          producer: 'Adobe PDF',
        },
      };
      (documentProcessingService.extractText as jest.Mock).mockResolvedValue(mockExtracted);
      (documentProcessingService.chunkDocument as jest.Mock).mockResolvedValue([]);

      // Register worker
      await resourceProcessor.registerResourceProcessor();
      const workCall = (mockQueue.work as jest.Mock).mock.calls[0];
      const processorFn = workCall[2];

      const mockJob = {
        id: 'job-metadata',
        data: { resourceId, campaignId, filePath, userId },
      };

      await processorFn(mockJob);

      // Verify metadata was updated
      expect(mockDb.none).toHaveBeenCalledWith(
        expect.stringContaining('total_pages'),
        expect.arrayContaining([
          25,
          'Player\'s Handbook',
          'Wizards of the Coast',
          expect.stringContaining('Adobe'),
          resourceId,
        ])
      );
    });

    it('should update processing_duration_ms on completion', async () => {
      const mockExtracted = {
        totalPages: 1,
        pages: [],
        metadata: {},
      };
      (documentProcessingService.extractText as jest.Mock).mockResolvedValue(mockExtracted);
      (documentProcessingService.chunkDocument as jest.Mock).mockResolvedValue([]);

      // Register worker
      await resourceProcessor.registerResourceProcessor();
      const workCall = (mockQueue.work as jest.Mock).mock.calls[0];
      const processorFn = workCall[2];

      const mockJob = {
        id: 'job-duration',
        data: { resourceId, campaignId, filePath, userId },
      };

      await processorFn(mockJob);

      // Verify duration was recorded (without embeddings due to rate limit)
      expect(mockDb.none).toHaveBeenCalledWith(
        expect.stringContaining('processing_duration_ms'),
        expect.arrayContaining([
          0, // chunks.length
          'completed_no_embeddings',
          expect.any(Number), // duration
          resourceId,
        ])
      );
    });

    it('should update processing_duration_ms on failure', async () => {
      // Mock extraction failure
      (documentProcessingService.extractText as jest.Mock).mockRejectedValue(
        new Error('Processing error')
      );

      // Register worker
      await resourceProcessor.registerResourceProcessor();
      const workCall = (mockQueue.work as jest.Mock).mock.calls[0];
      const processorFn = workCall[2];

      const mockJob = {
        id: 'job-fail-duration',
        data: { resourceId, campaignId, filePath, userId },
      };

      await expect(processorFn(mockJob)).rejects.toThrow('Processing error');

      // Verify duration was recorded even on failure
      expect(mockDb.none).toHaveBeenCalledWith(
        expect.stringContaining('processing_completed_at'),
        [expect.any(Number), resourceId]
      );
    });
  });

  describe('registerResourceProcessor', () => {
    it('should register worker with correct configuration', async () => {
      await resourceProcessor.registerResourceProcessor();

      expect(mockQueue.work).toHaveBeenCalledWith(
        'process-resource',
        {
          teamSize: 5,
          teamConcurrency: 1,
        },
        expect.any(Function)
      );

      expect(logger.info).toHaveBeenCalledWith(
        'Resource processor worker registered',
        expect.objectContaining({
          queueName: 'process-resource',
          teamSize: 5,
          teamConcurrency: 1,
        })
      );
    });

    it('should handle registration errors', async () => {
      (mockQueue.work as jest.Mock).mockRejectedValue(new Error('Queue unavailable'));

      await expect(resourceProcessor.registerResourceProcessor()).rejects.toThrow(
        'Queue unavailable'
      );

      expect(logger.error).toHaveBeenCalledWith(
        'Failed to register resource processor worker',
        expect.objectContaining({
          error: 'Queue unavailable',
        })
      );
    });

    it('should log job execution errors', async () => {
      // Mock extraction failure
      (documentProcessingService.extractText as jest.Mock).mockRejectedValue(
        new Error('Job error')
      );

      await resourceProcessor.registerResourceProcessor();

      // Get the registered work function
      const workCall = (mockQueue.work as jest.Mock).mock.calls[0];
      const processorFn = workCall[2];

      const mockJob = {
        id: 'job-err',
        data: { resourceId, campaignId, filePath, userId },
      };

      await expect(processorFn(mockJob)).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        'Job execution failed',
        expect.objectContaining({
          jobId: 'job-err',
          resourceId,
        })
      );
    });
  });

  describe('getProcessingStats', () => {
    it('should return processing statistics', async () => {
      mockQueue.getQueueSize.mockResolvedValue(15);

      const stats = await resourceProcessor.getProcessingStats();

      expect(stats).toEqual({
        queueName: 'process-resource',
        queueSize: 15,
        timestamp: expect.any(String),
      });

      expect(mockQueue.getQueueSize).toHaveBeenCalledWith('process-resource');
    });

    it('should return null on error', async () => {
      mockQueue.getQueueSize.mockRejectedValue(new Error('Queue error'));

      const stats = await resourceProcessor.getProcessingStats();

      expect(stats).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to get processing stats',
        expect.objectContaining({
          error: 'Queue error',
        })
      );
    });

    it('should format timestamp as ISO string', async () => {
      const stats = await resourceProcessor.getProcessingStats();

      expect(stats!.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });

  describe('Edge cases', () => {
    it('should handle PDF with no metadata', async () => {
      const mockExtracted = {
        totalPages: 5,
        pages: [],
        metadata: {},
      };
      (documentProcessingService.extractText as jest.Mock).mockResolvedValue(mockExtracted);
      (documentProcessingService.chunkDocument as jest.Mock).mockResolvedValue([]);

      await resourceProcessor.registerResourceProcessor();
      const workCall = (mockQueue.work as jest.Mock).mock.calls[0];
      const processorFn = workCall[2];

      const mockJob = {
        id: 'job-no-meta',
        data: { resourceId, campaignId, filePath, userId },
      };

      await processorFn(mockJob);

      // Should handle null metadata gracefully
      expect(mockDb.none).toHaveBeenCalledWith(
        expect.stringContaining('title'),
        expect.arrayContaining([
          5,
          null, // title
          null, // author
          expect.any(String), // metadata JSON
          resourceId,
        ])
      );
    });

    it('should handle chunks with missing optional fields', async () => {
      const mockExtracted = {
        totalPages: 1,
        pages: [],
        metadata: {},
      };
      (documentProcessingService.extractText as jest.Mock).mockResolvedValue(mockExtracted);

      const mockChunks = [
        {
          content: 'Minimal chunk',
          tokenCount: 50,
          pageNumber: undefined as any,
          sectionHeading: undefined as any,
          startOffset: 0,
          endOffset: 30,
        },
      ];
      (documentProcessingService.chunkDocument as jest.Mock).mockResolvedValue(mockChunks);

      await resourceProcessor.registerResourceProcessor();
      const workCall = (mockQueue.work as jest.Mock).mock.calls[0];
      const processorFn = workCall[2];

      const mockJob = {
        id: 'job-minimal',
        data: { resourceId, campaignId, filePath, userId },
      };

      // Should not throw error
      await processorFn(mockJob);

      expect(logger.info).toHaveBeenCalledWith(
        'Chunks inserted successfully',
        expect.any(Object)
      );
    });
  });
});
