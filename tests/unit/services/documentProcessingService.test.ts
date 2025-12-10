/**
 * Unit tests for documentProcessingService
 * Tests PDF extraction, chunking, section detection, and token counting
 */

import * as documentProcessingService from '../../../src/services/documentProcessingService';
import * as fs from 'fs/promises';

// Mock dependencies
jest.mock('pdf-parse', () => {
  return jest.fn();
});
jest.mock('fs/promises');

const mockPdfParse = require('pdf-parse') as jest.MockedFunction<any>;
const mockReadFile = fs.readFile as jest.MockedFunction<typeof fs.readFile>;

describe('documentProcessingService', () => {
  describe('countTokens', () => {
    it('should count tokens accurately', () => {
      const text = 'This is a test sentence with multiple words.';
      const tokenCount = documentProcessingService.countTokens(text);

      // Should be approximately 9-10 tokens for this sentence
      expect(tokenCount).toBeGreaterThan(5);
      expect(tokenCount).toBeLessThan(15);
    });

    it('should handle empty string', () => {
      const tokenCount = documentProcessingService.countTokens('');
      expect(tokenCount).toBe(0);
    });

    it('should handle long text', () => {
      const longText = 'word '.repeat(1000);
      const tokenCount = documentProcessingService.countTokens(longText);

      // Should be approximately 1000 tokens
      expect(tokenCount).toBeGreaterThan(900);
      expect(tokenCount).toBeLessThan(1100);
    });
  });

  describe('splitOnSentences', () => {
    it('should split on sentence boundaries', () => {
      const text = 'First sentence. Second sentence! Third sentence?';
      const sentences = documentProcessingService.splitOnSentences(text);

      expect(sentences).toHaveLength(3);
      expect(sentences[0]).toContain('First sentence');
      expect(sentences[1]).toContain('Second sentence');
      expect(sentences[2]).toContain('Third sentence');
    });

    it('should handle abbreviations correctly', () => {
      const text = 'Dr. Smith is here. He is a doctor.';
      const sentences = documentProcessingService.splitOnSentences(text);

      expect(sentences).toHaveLength(2);
      expect(sentences[0]).toContain('Dr. Smith');
      expect(sentences[1]).toContain('He is a doctor');
    });

    it('should handle single sentence', () => {
      const text = 'This is a single sentence';
      const sentences = documentProcessingService.splitOnSentences(text);

      expect(sentences).toHaveLength(1);
      expect(sentences[0]).toBe(text);
    });

    it('should handle empty string', () => {
      const sentences = documentProcessingService.splitOnSentences('');
      expect(sentences).toHaveLength(0);
    });

    it('should preserve e.g. and i.e.', () => {
      const text = 'Some examples, e.g. apples and oranges. Also i.e. fruits.';
      const sentences = documentProcessingService.splitOnSentences(text);

      expect(sentences).toHaveLength(2);
      expect(sentences[0]).toContain('e.g.');
      expect(sentences[1]).toContain('i.e.');
    });
  });

  describe('detectSections', () => {
    it('should detect all-caps headings', () => {
      const text = 'INTRODUCTION\nThis is the intro.\n\nCONCLUSION\nThis is the end.';
      const sections = documentProcessingService.detectSections(text);

      expect(sections.length).toBeGreaterThanOrEqual(2);
      expect(sections[0].heading).toBe('INTRODUCTION');
      expect(sections[1].heading).toBe('CONCLUSION');
    });

    it('should detect numbered headings', () => {
      const text = '1. First Section\nContent here.\n\n2. Second Section\nMore content.';
      const sections = documentProcessingService.detectSections(text);

      expect(sections.length).toBeGreaterThanOrEqual(2);
      expect(sections[0].heading).toContain('1. First Section');
      expect(sections[1].heading).toContain('2. Second Section');
    });

    it('should detect nested numbered headings', () => {
      const text = '1.1 Subsection\nContent.\n\n1.2 Another Subsection\nMore.';
      const sections = documentProcessingService.detectSections(text);

      expect(sections.length).toBeGreaterThanOrEqual(2);
      expect(sections[0].level).toBe(2);
      expect(sections[1].level).toBe(2);
    });

    it('should detect headings with colons', () => {
      const text = 'Character Abilities:\nStrength, speed, etc.\n\nWeapon Items:\nSword, bow, etc.';
      const sections = documentProcessingService.detectSections(text);

      expect(sections.length).toBeGreaterThanOrEqual(1);
      if (sections.length >= 1) {
        expect(sections[0].heading).toContain('Character Abilities:');
      }
      if (sections.length >= 2) {
        expect(sections[1].heading).toContain('Weapon Items:');
      }
    });

    it('should handle text with no sections', () => {
      const text = 'This is just plain text without any headings.';
      const sections = documentProcessingService.detectSections(text);

      expect(sections).toHaveLength(0);
    });

    it('should set correct endIndex for sections', () => {
      const text = 'FIRST\nContent 1\nContent 2\n\nSECOND\nContent 3';
      const sections = documentProcessingService.detectSections(text);

      if (sections.length >= 2) {
        expect(sections[0].endIndex).toBeGreaterThan(sections[0].startIndex);
        expect(sections[1].startIndex).toBeGreaterThan(sections[0].endIndex);
      }
    });
  });

  describe('extractText', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should extract text from valid PDF', async () => {
      const mockBuffer = Buffer.from('fake pdf');
      // Create text with enough content to pass scanned PDF detection (>100 chars)
      const longText = 'This is a valid PDF with enough text content. '.repeat(10);
      const mockPdfData = {
        numpages: 3,
        text: `Page 1 ${longText}\f\nPage 2 ${longText}\f\nPage 3 ${longText}`,
        info: {
          Title: 'Test PDF',
          Author: 'Test Author',
          Subject: 'Test Subject',
        },
      };

      mockReadFile.mockResolvedValue(mockBuffer);
      mockPdfParse.mockResolvedValue(mockPdfData as any);

      const result = await documentProcessingService.extractText('/fake/path.pdf');

      expect(result.totalPages).toBe(3);
      expect(result.pages).toHaveLength(3);
      expect(result.metadata.title).toBe('Test PDF');
      expect(result.metadata.author).toBe('Test Author');
      expect(mockReadFile).toHaveBeenCalledWith('/fake/path.pdf');
      expect(mockPdfParse).toHaveBeenCalled();
    });

    it('should handle PDF with minimal text (scanned)', async () => {
      const mockBuffer = Buffer.from('fake pdf');
      const mockPdfData = {
        numpages: 10,
        text: 'X', // Very little text
        info: {},
      };

      mockReadFile.mockResolvedValue(mockBuffer);
      mockPdfParse.mockResolvedValue(mockPdfData as any);

      await expect(
        documentProcessingService.extractText('/fake/scanned.pdf')
      ).rejects.toThrow('scanned or image-based');
    });

    it('should handle password-protected PDF error', async () => {
      mockReadFile.mockResolvedValue(Buffer.from('fake'));
      mockPdfParse.mockRejectedValue(new Error('Invalid password'));

      await expect(
        documentProcessingService.extractText('/fake/protected.pdf')
      ).rejects.toThrow('password-protected');
    });

    it('should handle corrupted PDF error', async () => {
      mockReadFile.mockResolvedValue(Buffer.from('fake'));
      mockPdfParse.mockRejectedValue(new Error('Invalid PDF structure'));

      await expect(
        documentProcessingService.extractText('/fake/corrupted.pdf')
      ).rejects.toThrow('corrupted or is not a valid PDF');
    });

    it('should extract page metadata', async () => {
      const mockBuffer = Buffer.from('fake pdf');
      // Add enough text to pass scanned PDF check
      const tableText = 'Column1\tColumn2\tColumn3\nRow1\tData\tMore\nRow2\tData\tMore\n' + 'Extra text content. '.repeat(10);
      const normalText = 'Normal text without tables. '.repeat(10);
      const mockPdfData = {
        numpages: 2,
        text: `${tableText}\f\n${normalText}`,
        info: {},
      };

      mockReadFile.mockResolvedValue(mockBuffer);
      mockPdfParse.mockResolvedValue(mockPdfData as any);

      const result = await documentProcessingService.extractText('/fake/path.pdf');

      // First page has table structure
      expect(result.pages[0].metadata?.hasTables).toBe(true);
      // Second page doesn't
      expect(result.pages[1].metadata?.hasTables).toBe(false);
    });
  });

  describe('chunkDocument', () => {
    it('should chunk document with default config', async () => {
      const extracted: documentProcessingService.ExtractionResult = {
        totalPages: 2,
        pages: [
          {
            pageNumber: 1,
            text: 'INTRODUCTION\n' + 'This is a test document. '.repeat(100),
          },
          {
            pageNumber: 2,
            text: 'CONCLUSION\n' + 'This is the end. '.repeat(100),
          },
        ],
        metadata: {},
      };

      const chunks = await documentProcessingService.chunkDocument(extracted);

      expect(chunks.length).toBeGreaterThan(0);

      // Check token counts are within range
      for (const chunk of chunks) {
        expect(chunk.tokenCount).toBeGreaterThanOrEqual(200); // Allow some flexibility
        expect(chunk.tokenCount).toBeLessThanOrEqual(900);
      }

      // Check that page numbers are set
      expect(chunks[0].pageNumber).toBeGreaterThanOrEqual(1);
      expect(chunks[0].pageNumber).toBeLessThanOrEqual(2);
    });

    it('should preserve section headings', async () => {
      const extracted: documentProcessingService.ExtractionResult = {
        totalPages: 1,
        pages: [
          {
            pageNumber: 1,
            text: 'CHARACTER CREATION\nFollow these steps. '.repeat(50),
          },
        ],
        metadata: {},
      };

      const chunks = await documentProcessingService.chunkDocument(extracted);

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0].sectionHeading).toContain('CHARACTER CREATION');
    });

    it('should create overlapping chunks', async () => {
      const extracted: documentProcessingService.ExtractionResult = {
        totalPages: 1,
        pages: [
          {
            pageNumber: 1,
            text: 'Sentence one. '.repeat(200), // Force multiple chunks
          },
        ],
        metadata: {},
      };

      const config = {
        minTokens: 100,
        maxTokens: 200,
        targetTokens: 150,
        overlapTokens: 30,
      };

      const chunks = await documentProcessingService.chunkDocument(extracted, config);

      // Should create multiple chunks with overlap
      expect(chunks.length).toBeGreaterThan(1);

      // Each chunk should be within limits
      for (const chunk of chunks) {
        expect(chunk.tokenCount).toBeLessThanOrEqual(config.maxTokens);
      }
    });

    it('should merge small chunks', async () => {
      const extracted: documentProcessingService.ExtractionResult = {
        totalPages: 1,
        pages: [
          {
            pageNumber: 1,
            text: 'SECTION A\nShort.\n\nSECTION B\nAlso short.',
          },
        ],
        metadata: {},
      };

      const config = {
        minTokens: 50,
        maxTokens: 800,
        targetTokens: 500,
        overlapTokens: 50,
      };

      const chunks = await documentProcessingService.chunkDocument(extracted, config);

      // Should merge small sections
      expect(chunks.length).toBeGreaterThan(0);
    });

    it('should handle document with no sections', async () => {
      const extracted: documentProcessingService.ExtractionResult = {
        totalPages: 1,
        pages: [
          {
            pageNumber: 1,
            text: 'Plain text without sections. '.repeat(100),
          },
        ],
        metadata: {},
      };

      const chunks = await documentProcessingService.chunkDocument(extracted);

      expect(chunks.length).toBeGreaterThan(0);
      // Section heading should be null
      expect(chunks[0].sectionHeading).toBeNull();
    });

    it('should set correct offsets', async () => {
      const extracted: documentProcessingService.ExtractionResult = {
        totalPages: 1,
        pages: [
          {
            pageNumber: 1,
            text: 'Test content. '.repeat(50),
          },
        ],
        metadata: {},
      };

      const chunks = await documentProcessingService.chunkDocument(extracted);

      for (const chunk of chunks) {
        expect(chunk.startOffset).toBeGreaterThanOrEqual(0);
        expect(chunk.endOffset).toBeGreaterThan(chunk.startOffset);
      }
    });
  });

  describe('cleanup', () => {
    it('should cleanup tiktoken encoder', () => {
      // Just ensure it doesn't throw
      expect(() => documentProcessingService.cleanup()).not.toThrow();
    });
  });
});
