/**
 * Document Processing Service
 * Handles PDF, DOCX, and TXT text extraction, chunking, and section detection
 */

import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import * as path from 'path';
import { readFile } from 'fs/promises';
import { encoding_for_model } from 'tiktoken';
import logger from '../utils/logger';

// Types for extracted data
export interface ExtractedPage {
  pageNumber: number;
  text: string;
  metadata?: {
    hasImages: boolean;
    hasTables: boolean;
  };
}

export interface ExtractionResult {
  pages: ExtractedPage[];
  totalPages: number;
  metadata: {
    title?: string;
    author?: string;
    subject?: string;
    creator?: string;
    producer?: string;
  };
}

export interface Chunk {
  content: string;
  tokenCount: number;
  pageNumber: number;
  sectionHeading: string | null;
  startOffset: number;
  endOffset: number;
}

export interface ChunkingConfig {
  minTokens: number;
  maxTokens: number;
  targetTokens: number;
  overlapTokens: number;
}

export interface Section {
  heading: string;
  startIndex: number;
  endIndex: number;
  level: number;
}

// Default chunking configuration
const DEFAULT_CHUNKING_CONFIG: ChunkingConfig = {
  minTokens: 300,
  maxTokens: 800,
  targetTokens: 500,
  overlapTokens: 50,
};

// Initialize tiktoken encoder
let encoder: any = null;

function getEncoder() {
  if (!encoder) {
    encoder = encoding_for_model('gpt-4');
  }
  return encoder;
}

/**
 * Count tokens in text using tiktoken
 */
export function countTokens(text: string): number {
  try {
    const enc = getEncoder();
    const tokens = enc.encode(text);
    return tokens.length;
  } catch (error) {
    logger.error('Error counting tokens', { error });
    return Math.ceil(text.length / 4);
  }
}

/**
 * Main Entry Point: Extract text based on file extension
 */
export async function extractText(filePath: string): Promise<ExtractionResult> {
  const extension = path.extname(filePath).toLowerCase();

  logger.info('Starting extraction', { filePath, extension });

  try {
    switch (extension) {
      case '.pdf':
        return await extractPdf(filePath);
      case '.docx':
        return await extractDocx(filePath);
      case '.txt':
      case '.md':
      case '.json':
        return await extractPlainText(filePath);
      case '.doc':
        throw new Error(
          'Legacy .doc (binary) format is not supported. Please convert to .docx or .pdf.'
        );
      default:
        throw new Error(`Unsupported file extension: ${extension}`);
    }
  } catch (error: any) {
    logger.error('Failed to extract text', {
      filePath,
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

/**
 * Strategy: PDF Extraction
 */
async function extractPdf(filePath: string): Promise<ExtractionResult> {
  try {
    const dataBuffer = await readFile(filePath);
    const data = await pdfParse(dataBuffer);

    const pages: ExtractedPage[] = [];
    const pageTexts = data.text.split('\f');

    for (let i = 0; i < data.numpages; i++) {
      const pageText = i < pageTexts.length ? pageTexts[i] : '';

      pages.push({
        pageNumber: i + 1,
        text: pageText.trim(),
        metadata: {
          hasImages: false, 
          hasTables: detectTables(pageText),
        },
      });
    }

    const result: ExtractionResult = {
      pages,
      totalPages: data.numpages,
      metadata: {
        title: data.info?.Title,
        author: data.info?.Author,
        subject: data.info?.Subject,
        creator: data.info?.Creator,
        producer: data.info?.Producer,
      },
    };

    if (data.text.trim().length < 100 && data.numpages > 1) {
      throw new Error(
        'PDF appears to be scanned or image-based. OCR is not currently supported.'
      );
    }

    return result;
  } catch (error: any) {
    if (error.message.includes('password')) {
      throw new Error('PDF is password-protected.');
    }
    throw error;
  }
}

/**
 * Strategy: DOCX Extraction
 */
async function extractDocx(filePath: string): Promise<ExtractionResult> {
  const dataBuffer = await readFile(filePath);
  
  // Extract raw text
  const result = await mammoth.extractRawText({ buffer: dataBuffer });
  const text = result.value;
  const messages = result.messages;

  if (messages.length > 0) {
    logger.debug('Mammoth extraction warnings', { messages });
  }

  return {
    pages: [{
      pageNumber: 1,
      text: text.trim(),
      metadata: {
        hasImages: messages.some(m => m.message.includes('image')),
        hasTables: detectTables(text),
      }
    }],
    totalPages: 1,
    metadata: {
      title: path.basename(filePath, '.docx'),
      author: undefined, 
    },
  };
}

/**
 * Strategy: Plain Text Extraction
 */
async function extractPlainText(filePath: string): Promise<ExtractionResult> {
  const text = await readFile(filePath, 'utf-8');

  return {
    pages: [{
      pageNumber: 1,
      text: text.trim(),
      metadata: {
        hasImages: false,
        hasTables: detectTables(text),
      }
    }],
    totalPages: 1,
    metadata: {
      title: path.basename(filePath),
      author: undefined,
    },
  };
}

/**
 * Detect if text contains table-like structures
 */
function detectTables(text: string): boolean {
  const lines = text.split('\n');
  let consecutiveTabLines = 0;

  for (const line of lines) {
    if (line.includes('\t') || /\s{3,}/.test(line)) {
      consecutiveTabLines++;
      if (consecutiveTabLines >= 3) {
        return true;
      }
    } else {
      consecutiveTabLines = 0;
    }
  }

  return false;
}

/**
 * Detect sections in text based on heading patterns
 */
export function detectSections(text: string): Section[] {
  const sections: Section[] = [];
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const nextLine = i < lines.length - 1 ? lines[i + 1].trim() : '';
    const prevLine = i > 0 ? lines[i - 1].trim() : '';

    if (!line) continue;
    if (line.length < 4) continue;

    let isHeading = false;
    let level = 1;

    // Pattern 1: All-caps lines
    if (/^[A-Z\s0-9]{5,}$/.test(line) && line.length < 80) {
      isHeading = true;
      level = 1;
    }
    // Pattern 2: Numbered headings (1., 1.1)
    else if (/^\d+\.\s+\w/.test(line)) {
      isHeading = true;
      level = 1;
    } else if (/^\d+\.\d+\s+\w/.test(line)) {
      isHeading = true;
      level = 2;
    } else if (/^\d+\.\d+\.\d+\s+\w/.test(line)) {
      isHeading = true;
      level = 3;
    }
    // Pattern 3: Markdown Headers (New Support)
    else if (/^#+\s/.test(line)) {
        isHeading = true;
        level = (line.match(/^#+/) || [''])[0].length;
    }
    // Pattern 4: Short lines preceded by blank line (checking previous line was handled implicitly by logic flow but explicit here is better if we tracked it differently, here we rely on line content mostly)
    else if (line.length >= 10 && line.length < 60 && !prevLine && nextLine) {
       if (/^[A-Z]/.test(line) && !/[.!?]$/.test(line)) {
        isHeading = true;
        level = 2;
      }
    }
    // Pattern 5: Lines ending with colon
    else if (/:$/.test(line) && line.length >= 5 && line.length < 60) {
      isHeading = true;
      level = 2;
    }

    if (isHeading) {
      sections.push({
        heading: line.replace(/^#+\s/, ''), // Clean markdown syntax
        startIndex: i,
        endIndex: -1, 
        level,
      });
    }
  }

  // Set end indices
  for (let i = 0; i < sections.length; i++) {
    if (i < sections.length - 1) {
      sections[i].endIndex = sections[i + 1].startIndex - 1;
    } else {
      sections[i].endIndex = lines.length - 1;
    }
  }

  return sections;
}

/**
 * Split text on sentence boundaries
 */
export function splitOnSentences(text: string): string[] {
  const sentences: string[] = [];

  // Protect common abbreviations
  let processed = text
    .replace(/Dr\./g, 'Dr<DOT>')
    .replace(/Mr\./g, 'Mr<DOT>')
    .replace(/Mrs\./g, 'Mrs<DOT>')
    .replace(/Ms\./g, 'Ms<DOT>')
    .replace(/Jr\./g, 'Jr<DOT>')
    .replace(/Sr\./g, 'Sr<DOT>')
    .replace(/vs\./g, 'vs<DOT>')
    .replace(/e\.g\./g, 'e<DOT>g<DOT>')
    .replace(/i\.e\./g, 'i<DOT>e<DOT>')
    .replace(/etc\./g, 'etc<DOT>');

  // Split on sentence boundaries
  const parts = processed.split(/([.!?]+[\s\n]+)/);

  let currentSentence = '';
  for (const part of parts) {
    currentSentence += part;

    if (/[.!?]+[\s\n]+$/.test(part)) {
      if (currentSentence.trim()) {
        const restored = currentSentence.replace(/<DOT>/g, '.');
        sentences.push(restored.trim());
      }
      currentSentence = '';
    }
  }

  if (currentSentence.trim()) {
    const restored = currentSentence.replace(/<DOT>/g, '.');
    sentences.push(restored.trim());
  }

  return sentences;
}

/**
 * Chunk document into segments
 */
export async function chunkDocument(
  extracted: ExtractionResult,
  config: ChunkingConfig = DEFAULT_CHUNKING_CONFIG
): Promise<Chunk[]> {
  const chunks: Chunk[] = [];

  logger.info('Starting document chunking', {
    totalPages: extracted.totalPages,
    config,
  });

  let fullText = '';
  const pageMarkers: Array<{ pageNumber: number; offset: number }> = [];

  for (const page of extracted.pages) {
    pageMarkers.push({
      pageNumber: page.pageNumber,
      offset: fullText.length,
    });
    fullText += page.text + '\n\n';
  }

  const sections = detectSections(fullText);

  for (const section of sections) {
    const lines = fullText.split('\n');
    const sectionLines = lines.slice(section.startIndex, section.endIndex + 1);
    const sectionText = sectionLines.join('\n').trim();

    if (!sectionText) continue;

    const sectionTokens = countTokens(sectionText);

    if (sectionTokens <= config.maxTokens) {
      const startOffset = lines.slice(0, section.startIndex).join('\n').length;
      chunks.push({
        content: sectionText,
        tokenCount: sectionTokens,
        pageNumber: getPageNumberForOffset(startOffset, pageMarkers),
        sectionHeading: section.heading,
        startOffset,
        endOffset: startOffset + sectionText.length,
      });
    } else {
      const sectionChunks = splitLargeSection(
        sectionText,
        section.heading,
        config,
        lines.slice(0, section.startIndex).join('\n').length,
        pageMarkers
      );
      chunks.push(...sectionChunks);
    }
  }

  if (sections.length === 0) {
    logger.warn('No sections detected, chunking entire document');
    const documentChunks = splitLargeSection(
      fullText,
      null,
      config,
      0,
      pageMarkers
    );
    chunks.push(...documentChunks);
  }

  const mergedChunks = mergeSmallChunks(chunks, config);

  return mergedChunks;
}

/**
 * Split a large section into smaller chunks with overlap
 */
function splitLargeSection(
  text: string,
  sectionHeading: string | null,
  config: ChunkingConfig,
  baseOffset: number,
  pageMarkers: Array<{ pageNumber: number; offset: number }>
): Chunk[] {
  const chunks: Chunk[] = [];
  const sentences = splitOnSentences(text);

  let currentChunk = '';
  let currentTokens = 0;
  let chunkStartOffset = baseOffset;

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
    const sentenceTokens = countTokens(sentence);

    if (currentTokens + sentenceTokens > config.maxTokens && currentChunk) {
      chunks.push({
        content: currentChunk.trim(),
        tokenCount: currentTokens,
        pageNumber: getPageNumberForOffset(chunkStartOffset, pageMarkers),
        sectionHeading,
        startOffset: chunkStartOffset,
        endOffset: chunkStartOffset + currentChunk.length,
      });

      const overlapSentences: string[] = [];
      let overlapTokens = 0;

      for (let j = i - 1; j >= 0 && overlapTokens < config.overlapTokens; j--) {
        const overlapSentence = sentences[j];
        const overlapSentenceTokens = countTokens(overlapSentence);

        if (overlapTokens + overlapSentenceTokens <= config.overlapTokens) {
          overlapSentences.unshift(overlapSentence);
          overlapTokens += overlapSentenceTokens;
        } else {
          break;
        }
      }

      currentChunk = overlapSentences.join(' ') + (overlapSentences.length > 0 ? ' ' : '');
      currentTokens = overlapTokens;
      chunkStartOffset = chunkStartOffset + currentChunk.length - overlapSentences.join(' ').length;
    }

    currentChunk += sentence + ' ';
    currentTokens += sentenceTokens;
  }

  if (currentChunk.trim()) {
    chunks.push({
      content: currentChunk.trim(),
      tokenCount: currentTokens,
      pageNumber: getPageNumberForOffset(chunkStartOffset, pageMarkers),
      sectionHeading,
      startOffset: chunkStartOffset,
      endOffset: baseOffset + text.length,
    });
  }

  return chunks;
}

/**
 * Merge consecutive chunks that are below minimum token count
 */
function mergeSmallChunks(chunks: Chunk[], config: ChunkingConfig): Chunk[] {
  const merged: Chunk[] = [];
  let i = 0;

  while (i < chunks.length) {
    let currentChunk = chunks[i];

    while (
      currentChunk.tokenCount < config.minTokens &&
      i + 1 < chunks.length
    ) {
      const nextChunk = chunks[i + 1];
      const combinedTokens = currentChunk.tokenCount + nextChunk.tokenCount;

      if (combinedTokens <= config.maxTokens) {
        const sectionHeading = currentChunk.sectionHeading || nextChunk.sectionHeading;

        currentChunk = {
          content: currentChunk.content + '\n\n' + nextChunk.content,
          tokenCount: combinedTokens,
          pageNumber: currentChunk.pageNumber,
          sectionHeading,
          startOffset: currentChunk.startOffset,
          endOffset: nextChunk.endOffset,
        };
        i++;
      } else {
        break;
      }
    }

    merged.push(currentChunk);
    i++;
  }

  return merged;
}

/**
 * Get page number for a given text offset
 */
function getPageNumberForOffset(
  offset: number,
  pageMarkers: Array<{ pageNumber: number; offset: number }>
): number {
  for (let i = pageMarkers.length - 1; i >= 0; i--) {
    if (offset >= pageMarkers[i].offset) {
      return pageMarkers[i].pageNumber;
    }
  }
  return 1;
}

/**
 * Cleanup tiktoken encoder when shutting down
 */
export function cleanup(): void {
  if (encoder) {
    encoder.free();
    encoder = null;
  }
}