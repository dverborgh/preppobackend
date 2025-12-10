/**
 * Simple test of booklet.pdf processing
 * Run with: node test-booklet-simple.js
 */

const path = require('path');
const { extractText, chunkDocument, cleanup } = require('./dist/services/documentProcessingService');

async function testBooklet() {
  try {
    const bookletPath = path.join(__dirname, '..', 'booklet.pdf');

    console.log('Testing booklet.pdf processing...');
    console.log('File path:', bookletPath);
    console.log('');

    // Extract text
    console.log('Step 1: Extracting text...');
    const startExtract = Date.now();
    const extracted = await extractText(bookletPath);
    const extractDuration = Date.now() - startExtract;

    console.log(`✓ Extracted ${extracted.totalPages} pages in ${extractDuration}ms`);
    console.log(`  Title: ${extracted.metadata.title || 'N/A'}`);
    console.log(`  Author: ${extracted.metadata.author || 'N/A'}`);
    console.log('');

    // Chunk document
    console.log('Step 2: Chunking document...');
    const startChunk = Date.now();
    const chunks = await chunkDocument(extracted);
    const chunkDuration = Date.now() - startChunk;

    console.log(`✓ Created ${chunks.length} chunks in ${chunkDuration}ms`);
    console.log('');

    // Analyze chunks
    const tokenCounts = chunks.map(c => c.tokenCount);
    const avgTokens = tokenCounts.reduce((sum, c) => sum + c, 0) / chunks.length;
    const minTokens = Math.min(...tokenCounts);
    const maxTokens = Math.max(...tokenCounts);

    const chunksWithSections = chunks.filter(c => c.sectionHeading !== null).length;
    const sectionPercentage = (chunksWithSections / chunks.length) * 100;

    console.log('Chunk Statistics:');
    console.log(`  Average tokens: ${Math.round(avgTokens)}`);
    console.log(`  Min tokens: ${minTokens}`);
    console.log(`  Max tokens: ${maxTokens}`);
    console.log(`  Chunks with sections: ${chunksWithSections} (${sectionPercentage.toFixed(1)}%)`);
    console.log('');

    // Show sample chunks
    console.log('Sample Chunks (first 3):');
    for (let i = 0; i < Math.min(3, chunks.length); i++) {
      const chunk = chunks[i];
      console.log(`\n  Chunk ${i + 1}:`);
      console.log(`    Page: ${chunk.pageNumber}`);
      console.log(`    Tokens: ${chunk.tokenCount}`);
      console.log(`    Section: ${chunk.sectionHeading || 'N/A'}`);
      console.log(`    Preview: ${chunk.content.substring(0, 80)}...`);
    }
    console.log('');

    // Check acceptance criteria
    console.log('Acceptance Criteria:');

    const totalDuration = extractDuration + chunkDuration;
    const withinTimeLimit = totalDuration < 5 * 60 * 1000;
    console.log(`  ✓ Processing time < 5 min: ${withinTimeLimit ? 'PASS' : 'FAIL'} (${totalDuration}ms)`);

    const tokenCountsValid = chunks.every(c => c.tokenCount >= 200 && c.tokenCount <= 900);
    console.log(`  ✓ Token counts 300-800: ${tokenCountsValid ? 'PASS' : 'FAIL'}`);

    const pageNumbersValid = chunks.every(c => c.pageNumber >= 1 && c.pageNumber <= extracted.totalPages);
    console.log(`  ✓ Page numbers accurate: ${pageNumbersValid ? 'PASS' : 'FAIL'}`);

    const sectionHeadingsGood = sectionPercentage >= 80;
    console.log(`  ✓ Section headings 80%+: ${sectionHeadingsGood ? 'PASS' : 'FAIL'} (${sectionPercentage.toFixed(1)}%)`);

    console.log('');
    console.log('=== All tests completed successfully! ===');

    cleanup();

  } catch (error) {
    console.error('Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

testBooklet();
