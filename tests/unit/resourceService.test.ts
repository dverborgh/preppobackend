/**
 * Unit tests for resourceService
 * Tests resource CRUD operations with mocked database and file system
 */

import * as fs from 'fs/promises';
import {
  uploadResource,
  getResource,
  listResources,
  deleteResource,
  updateProcessingStatus,
  ProcessingStatus,
} from '../../src/services/resourceService';
import {
  NotFoundError,
  ForbiddenError,
  ValidationError,
  InvalidFileTypeError,
  FileSizeLimitError,
} from '../../src/types';
import * as campaignService from '../../src/services/campaignService';

// Mock dependencies
jest.mock('fs/promises');
jest.mock('file-type', () => ({
  fromFile: jest.fn(),
}));
jest.mock('../../src/services/campaignService');
jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  silent: true,
}));

describe('ResourceService', () => {
  let mockDb: any;
  const userId = 'user-123';
  const campaignId = 'campaign-123';
  const resourceId = 'resource-123';

  const mockFile: Express.Multer.File = {
    fieldname: 'file',
    originalname: 'test.pdf',
    encoding: '7bit',
    mimetype: 'application/pdf',
    size: 1024000, // 1MB
    destination: '/tmp',
    filename: 'test.pdf',
    path: '/tmp/test.pdf',
    buffer: Buffer.from(''),
    stream: {} as any,
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock database
    mockDb = {
      one: jest.fn(),
      oneOrNone: jest.fn(),
      any: jest.fn(),
      none: jest.fn(),
      result: jest.fn(),
    };

    // Mock file system operations
    (fs.mkdir as jest.Mock).mockResolvedValue(undefined);
    (fs.rename as jest.Mock).mockResolvedValue(undefined);
    (fs.unlink as jest.Mock).mockResolvedValue(undefined);
    (fs.rmdir as jest.Mock).mockResolvedValue(undefined);

    // Mock campaign ownership verification
    (campaignService.verifyCampaignOwnership as jest.Mock).mockResolvedValue(
      undefined
    );

    // Mock file-type validation
    const fileType = require('file-type');
    fileType.fromFile.mockResolvedValue({ mime: 'application/pdf' });
  });

  describe('uploadResource', () => {
    it('should upload a valid PDF file', async () => {
      const mockResourceId = { id: resourceId };
      const mockResource = {
        id: resourceId,
        campaign_id: campaignId,
        original_filename: 'test.pdf',
        file_url: `${campaignId}/${resourceId}/test.pdf`,
        file_size_bytes: 1024000,
        content_type: 'application/pdf',
        resource_type: null,
        title: null,
        author: null,
        uploaded_at: new Date(),
        ingestion_status: ProcessingStatus.PENDING,
        ingestion_error: null,
        total_pages: null,
        total_chunks: null,
        metadata: { tags: [] },
      };

      mockDb.one
        .mockResolvedValueOnce(mockResourceId)
        .mockResolvedValueOnce(mockResource);

      const result = await uploadResource(
        mockDb,
        userId,
        campaignId,
        mockFile
      );

      expect(result).toEqual(mockResource);
      expect(campaignService.verifyCampaignOwnership).toHaveBeenCalledWith(
        mockDb,
        userId,
        campaignId
      );
      expect(fs.mkdir).toHaveBeenCalled();
      expect(fs.rename).toHaveBeenCalled();
      expect(mockDb.one).toHaveBeenCalledTimes(2);
    });

    it('should upload a text file with tags', async () => {
      const textFile: Express.Multer.File = {
        ...mockFile,
        originalname: 'notes.txt',
        mimetype: 'text/plain',
        size: 5000,
      };

      const mockResourceId = { id: resourceId };
      const mockResource = {
        id: resourceId,
        campaign_id: campaignId,
        original_filename: 'notes.txt',
        file_url: `${campaignId}/${resourceId}/notes.txt`,
        file_size_bytes: 5000,
        content_type: 'text/plain',
        resource_type: null,
        title: null,
        author: null,
        uploaded_at: new Date(),
        ingestion_status: ProcessingStatus.PENDING,
        ingestion_error: null,
        total_pages: null,
        total_chunks: null,
        metadata: { tags: ['lore', 'npcs'] },
      };

      mockDb.one
        .mockResolvedValueOnce(mockResourceId)
        .mockResolvedValueOnce(mockResource);

      const result = await uploadResource(
        mockDb,
        userId,
        campaignId,
        textFile,
        ['lore', 'npcs']
      );

      expect(result).toEqual(mockResource);
      expect(result.metadata.tags).toEqual(['lore', 'npcs']);
    });

    it('should reject invalid file type', async () => {
      const invalidFile: Express.Multer.File = {
        ...mockFile,
        originalname: 'test.exe',
        mimetype: 'application/x-msdownload',
      };

      await expect(
        uploadResource(mockDb, userId, campaignId, invalidFile)
      ).rejects.toThrow(InvalidFileTypeError);
    });

    it('should reject oversized PDF file', async () => {
      const largeFile: Express.Multer.File = {
        ...mockFile,
        size: 60000000, // 60MB (exceeds 50MB limit)
      };

      await expect(
        uploadResource(mockDb, userId, campaignId, largeFile)
      ).rejects.toThrow(FileSizeLimitError);
    });

    it('should reject oversized text file', async () => {
      const largeTextFile: Express.Multer.File = {
        ...mockFile,
        originalname: 'large.txt',
        mimetype: 'text/plain',
        size: 15000000, // 15MB (exceeds 10MB limit for text)
      };

      await expect(
        uploadResource(mockDb, userId, campaignId, largeTextFile)
      ).rejects.toThrow(FileSizeLimitError);
    });

    it('should reject PDF with invalid MIME type', async () => {
      const fileType = require('file-type');
      fileType.fromFile.mockResolvedValue({ mime: 'text/plain' });

      await expect(
        uploadResource(mockDb, userId, campaignId, mockFile)
      ).rejects.toThrow(InvalidFileTypeError);
    });

    it('should rollback file on database error', async () => {
      const mockResourceId = { id: resourceId };
      mockDb.one
        .mockResolvedValueOnce(mockResourceId)
        .mockRejectedValueOnce(new Error('Database error'));

      await expect(
        uploadResource(mockDb, userId, campaignId, mockFile)
      ).rejects.toThrow('Database error');

      // File should be cleaned up
      expect(fs.unlink).toHaveBeenCalled();
    });

    it('should sanitize filename with special characters', async () => {
      const fileWithSpecialChars: Express.Multer.File = {
        ...mockFile,
        originalname: 'test file (copy) #2.pdf',
      };

      const mockResourceId = { id: resourceId };
      const mockResource = {
        id: resourceId,
        campaign_id: campaignId,
        original_filename: 'test file (copy) #2.pdf',
        file_url: `${campaignId}/${resourceId}/test_file__copy___2.pdf`,
        file_size_bytes: 1024000,
        content_type: 'application/pdf',
        resource_type: null,
        title: null,
        author: null,
        uploaded_at: new Date(),
        ingestion_status: ProcessingStatus.PENDING,
        ingestion_error: null,
        total_pages: null,
        total_chunks: null,
        metadata: { tags: [] },
      };

      mockDb.one
        .mockResolvedValueOnce(mockResourceId)
        .mockResolvedValueOnce(mockResource);

      const result = await uploadResource(
        mockDb,
        userId,
        campaignId,
        fileWithSpecialChars
      );

      // Verify filename was sanitized
      expect(result.file_url).toContain('test_file__copy___2.pdf');
    });

    it('should reject access to campaign not owned by user', async () => {
      (campaignService.verifyCampaignOwnership as jest.Mock).mockRejectedValue(
        new ForbiddenError('You do not have permission to access this campaign')
      );

      await expect(
        uploadResource(mockDb, userId, campaignId, mockFile)
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe('getResource', () => {
    it('should get resource by ID', async () => {
      const mockResource = {
        id: resourceId,
        campaign_id: campaignId,
        original_filename: 'test.pdf',
        file_url: `${campaignId}/${resourceId}/test.pdf`,
        file_size_bytes: 1024000,
        content_type: 'application/pdf',
        resource_type: null,
        title: null,
        author: null,
        uploaded_at: new Date(),
        ingestion_status: ProcessingStatus.COMPLETED,
        ingestion_error: null,
        total_pages: 100,
        total_chunks: 50,
        metadata: {},
      };

      mockDb.oneOrNone.mockResolvedValue(mockResource);

      const result = await getResource(mockDb, userId, resourceId);

      expect(result).toEqual(mockResource);
      expect(mockDb.oneOrNone).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
        [resourceId, userId]
      );
    });

    it('should throw NotFoundError if resource does not exist', async () => {
      mockDb.oneOrNone.mockResolvedValue(null);

      await expect(getResource(mockDb, userId, resourceId)).rejects.toThrow(
        NotFoundError
      );
    });

    it('should throw NotFoundError if user does not own campaign', async () => {
      mockDb.oneOrNone.mockResolvedValue(null);

      await expect(
        getResource(mockDb, 'other-user', resourceId)
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('listResources', () => {
    it('should list resources with default pagination', async () => {
      const mockResources = [
        {
          id: 'resource-1',
          campaign_id: campaignId,
          original_filename: 'test1.pdf',
          file_url: `${campaignId}/resource-1/test1.pdf`,
          file_size_bytes: 1024000,
          content_type: 'application/pdf',
          resource_type: null,
          title: null,
          author: null,
          uploaded_at: new Date(),
          ingestion_status: ProcessingStatus.COMPLETED,
          ingestion_error: null,
          total_pages: 50,
          total_chunks: 25,
          metadata: {},
          chunk_count: 25,
        },
        {
          id: 'resource-2',
          campaign_id: campaignId,
          original_filename: 'notes.txt',
          file_url: `${campaignId}/resource-2/notes.txt`,
          file_size_bytes: 5000,
          content_type: 'text/plain',
          resource_type: null,
          title: null,
          author: null,
          uploaded_at: new Date(),
          ingestion_status: ProcessingStatus.PENDING,
          ingestion_error: null,
          total_pages: null,
          total_chunks: null,
          metadata: {},
          chunk_count: 0,
        },
      ];

      mockDb.one.mockResolvedValue({ count: '2' });
      mockDb.any.mockResolvedValue(mockResources);

      const result = await listResources(mockDb, userId, campaignId);

      expect(result.data).toEqual(mockResources);
      expect(result.total).toBe(2);
      expect(result.skip).toBe(0);
      expect(result.limit).toBe(50);
    });

    it('should list resources with custom pagination', async () => {
      mockDb.one.mockResolvedValue({ count: '100' });
      mockDb.any.mockResolvedValue([]);

      const result = await listResources(
        mockDb,
        userId,
        campaignId,
        undefined,
        { skip: 20, limit: 10 }
      );

      expect(result.total).toBe(100);
      expect(result.skip).toBe(20);
      expect(result.limit).toBe(10);
    });

    it('should filter resources by status', async () => {
      mockDb.one.mockResolvedValue({ count: '1' });
      mockDb.any.mockResolvedValue([]);

      await listResources(
        mockDb,
        userId,
        campaignId,
        { status: ProcessingStatus.COMPLETED }
      );

      expect(mockDb.any).toHaveBeenCalledWith(
        expect.stringContaining('ingestion_status ='),
        expect.arrayContaining([campaignId, ProcessingStatus.COMPLETED])
      );
    });

    it('should filter resources by file type', async () => {
      mockDb.one.mockResolvedValue({ count: '1' });
      mockDb.any.mockResolvedValue([]);

      await listResources(
        mockDb,
        userId,
        campaignId,
        { fileType: 'application/pdf' }
      );

      expect(mockDb.any).toHaveBeenCalledWith(
        expect.stringContaining('content_type ='),
        expect.arrayContaining([campaignId, 'application/pdf'])
      );
    });

    it('should enforce pagination limits', async () => {
      mockDb.one.mockResolvedValue({ count: '1000' });
      mockDb.any.mockResolvedValue([]);

      // Test max limit
      await listResources(
        mockDb,
        userId,
        campaignId,
        undefined,
        { skip: 0, limit: 200 }
      );

      expect(mockDb.any).toHaveBeenCalledWith(
        expect.anything(),
        expect.arrayContaining([100]) // max limit is 100
      );
    });

    it('should reject access to campaign not owned by user', async () => {
      (campaignService.verifyCampaignOwnership as jest.Mock).mockRejectedValue(
        new ForbiddenError('You do not have permission to access this campaign')
      );

      await expect(
        listResources(mockDb, userId, campaignId)
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe('deleteResource', () => {
    it('should delete resource and file', async () => {
      const mockResource = {
        id: resourceId,
        campaign_id: campaignId,
        original_filename: 'test.pdf',
        file_url: `${campaignId}/${resourceId}/test.pdf`,
        file_size_bytes: 1024000,
        content_type: 'application/pdf',
        resource_type: null,
        title: null,
        author: null,
        uploaded_at: new Date(),
        ingestion_status: ProcessingStatus.COMPLETED,
        ingestion_error: null,
        total_pages: 100,
        total_chunks: 50,
        metadata: {},
      };

      mockDb.oneOrNone.mockResolvedValue(mockResource);
      mockDb.result.mockResolvedValue({ rowCount: 1 });

      await deleteResource(mockDb, userId, resourceId);

      expect(fs.unlink).toHaveBeenCalled();
      expect(mockDb.result).toHaveBeenCalledWith(
        'DELETE FROM resources WHERE id = $1',
        [resourceId]
      );
    });

    it('should continue with deletion even if file deletion fails', async () => {
      const mockResource = {
        id: resourceId,
        campaign_id: campaignId,
        original_filename: 'test.pdf',
        file_url: `${campaignId}/${resourceId}/test.pdf`,
        file_size_bytes: 1024000,
        content_type: 'application/pdf',
        resource_type: null,
        title: null,
        author: null,
        uploaded_at: new Date(),
        ingestion_status: ProcessingStatus.COMPLETED,
        ingestion_error: null,
        total_pages: 100,
        total_chunks: 50,
        metadata: {},
      };

      mockDb.oneOrNone.mockResolvedValue(mockResource);
      mockDb.result.mockResolvedValue({ rowCount: 1 });
      (fs.unlink as jest.Mock).mockRejectedValue(
        new Error('File not found')
      );

      // Should not throw
      await deleteResource(mockDb, userId, resourceId);

      expect(mockDb.result).toHaveBeenCalled();
    });

    it('should throw NotFoundError if resource does not exist', async () => {
      mockDb.oneOrNone.mockResolvedValue(null);

      await expect(
        deleteResource(mockDb, userId, resourceId)
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('updateProcessingStatus', () => {
    it('should update processing status to completed', async () => {
      mockDb.none.mockResolvedValue(undefined);

      await updateProcessingStatus(
        mockDb,
        resourceId,
        ProcessingStatus.COMPLETED
      );

      expect(mockDb.none).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE resources'),
        [ProcessingStatus.COMPLETED, null, resourceId]
      );
    });

    it('should update processing status to failed with error', async () => {
      mockDb.none.mockResolvedValue(undefined);

      await updateProcessingStatus(
        mockDb,
        resourceId,
        ProcessingStatus.FAILED,
        'PDF parsing error'
      );

      expect(mockDb.none).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE resources'),
        [ProcessingStatus.FAILED, 'PDF parsing error', resourceId]
      );
    });

    it('should reject invalid processing status', async () => {
      await expect(
        updateProcessingStatus(mockDb, resourceId, 'invalid' as ProcessingStatus)
      ).rejects.toThrow(ValidationError);
    });
  });
});
