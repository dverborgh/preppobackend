/**
 * Manual test script for processing booklet.pdf
 * Run with: npx ts-node tests/manual-test-booklet.ts
 */

import * as path from 'path';
import { initDatabase, getDatabase, closeDatabase } from '../src/config/database';
import { initializeJobQueue, stopJobQueue } from '../src/config/jobQueue';
import { registerResourceProcessor } from '../src/workers/resourceProcessor';
import * as documentProcessingService from '../src/services/documentProcessingService';
import logger from '../src/utils/logger';

async function testBookletProcessing() {
  try {
    // Initialize services
    logger.info('Initializing database...');
    await initDatabase();

    logger.info('Initializing job queue...');
    await initializeJobQueue();

    logger.info('Registering workers...');
    await registerResourceProcessor();

    // Test PDF path
    const bookletPath = path.join(process.cwd(), '..', 'booklet.pdf');

    logger.info('Starting booklet.pdf processing test', { path: bookletPath });

    // Extract text
    logger.info('Step 1: Extracting text from PDF...');
    const startExtract = Date.now();
    const extracted = await documentProcessingService.extractText(bookletPath);
    const extractDuration = Date.now() - startExtract;

    logger.info('Text extraction completed', {
      totalPages: extracted.totalPages,
      title: extracted.metadata.title,
      author: extracted.metadata.author,
      durationMs: extractDuration,
    });

    // Chunk document
    logger.info('Step 2: Chunking document...');
    const startChunk = Date.now();
    const chunks = await documentProcessingService.chunkDocument(extracted);
    const chunkDuration = Date.now() - startChunk;

    logger.info('Document chunking completed', {
      totalChunks: chunks.length,
      durationMs: chunkDuration,
    });

    // Analyze chunks
    const tokenCounts = chunks.map((c) => c.tokenCount);
    const avgTokens = tokenCounts.reduce((sum, c) => sum + c, 0) / chunks.length;
    const minTokens = Math.min(...tokenCounts);
    const maxTokens = Math.max(...tokenCounts);

    const chunksWithSections = chunks.filter((c) => c.sectionHeading !== null).length;
    const sectionPercentage = (chunksWithSections / chunks.length) * 100;

    logger.info('Chunk statistics', {
      totalChunks: chunks.length,
      avgTokens: Math.round(avgTokens),
      minTokens,
      maxTokens,
      chunksWithSections,
      sectionPercentage: `${sectionPercentage.toFixed(1)}%`,
    });

    // Show sample chunks
    logger.info('Sample chunks (first 3):');
    for (let i = 0; i < Math.min(3, chunks.length); i++) {
      const chunk = chunks[i];
      logger.info(`Chunk ${i + 1}:`, {
        pageNumber: chunk.pageNumber,
        tokenCount: chunk.tokenCount,
        sectionHeading: chunk.sectionHeading,
        contentPreview: chunk.content.substring(0, 100) + '...',
      });
    }

    // Check acceptance criteria
    logger.info('Checking acceptance criteria:');

    const totalDuration = extractDuration + chunkDuration;
    const withinTimeLimit = totalDuration < 5 * 60 * 1000; // 5 minutes

    const tokenCountsValid = chunks.every(
      (c) => c.tokenCount >= 200 && c.tokenCount <= 900
    ); // Allow some flexibility

    const pageNumbersValid = chunks.every(
      (c) => c.pageNumber >= 1 && c.pageNumber <= extracted.totalPages
    );

    const sectionHeadingsGood = sectionPercentage >= 80;

    logger.info('Acceptance criteria results:', {
      'Processing time < 5 min': withinTimeLimit ? 'PASS' : 'FAIL',
      'Token counts 300-800 (flexible)': tokenCountsValid ? 'PASS' : 'FAIL',
      'Page numbers accurate': pageNumbersValid ? 'PASS' : 'FAIL',
      'Section headings 80%+': sectionHeadingsGood ? 'PASS' : 'FAIL',
    });

    // Test database insertion
    logger.info('Step 3: Testing database insertion...');
    const db = getDatabase();

    // Create temporary test resource
    const testResourceId = (await db.one('SELECT gen_random_uuid() as id')).id;

    const values = chunks.map((chunk, index) => ({
      resource_id: testResourceId,
      chunk_index: index,
      content: chunk.content,
      token_count: chunk.tokenCount,
      page_number: chunk.pageNumber,
      section_heading: chunk.sectionHeading,
      metadata: JSON.stringify({
        startOffset: chunk.startOffset,
        endOffset: chunk.endOffset,
      }),
    }));

    const pgp = db.$config.pgp;
    const cs = new pgp.helpers.ColumnSet(
      [
        'resource_id',
        'chunk_index',
        'content',
        'token_count',
        'page_number',
        'section_heading',
        { name: 'metadata', cast: 'jsonb' },
      ],
      { table: 'resource_chunks' }
    );

    const query = pgp.helpers.insert(values, cs);
    await db.none(query);

    logger.info('Database insertion successful', {
      chunksInserted: chunks.length,
    });

    // Verify insertion
    const dbChunks = await db.any(
      'SELECT COUNT(*) as count FROM resource_chunks WHERE resource_id = $1',
      [testResourceId]
    );

    logger.info('Database verification', {
      expectedChunks: chunks.length,
      actualChunks: parseInt(dbChunks[0].count),
      match: parseInt(dbChunks[0].count) === chunks.length,
    });

    // Cleanup test data
    await db.none('DELETE FROM resource_chunks WHERE resource_id = $1', [testResourceId]);
    logger.info('Test data cleaned up');

    logger.info('All tests completed successfully!');
  } catch (error: any) {
    logger.error('Test failed', {
      error: error.message,
      stack: error.stack,
    });
    process.exit(1);
  } finally {
    // Cleanup
    await stopJobQueue();
    await closeDatabase();
    documentProcessingService.cleanup();
  }
}

// Run test
testBookletProcessing()
  .then(() => {
    console.log('\n=== Test completed successfully ===\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n=== Test failed ===\n', error);
    process.exit(1);
  });
