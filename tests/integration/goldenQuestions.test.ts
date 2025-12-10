/**
 * Golden Questions Test Suite for RAG Evaluation
 * Tests RAG quality against a curated set of questions with expected answers
 *
 * NOTE: This test suite requires:
 * 1. A test campaign with uploaded and processed booklet.pdf
 * 2. Valid OpenAI API key in environment
 * 3. Database with embeddings and vector search enabled
 *
 * This is an E2E test that actually calls OpenAI API and tests real retrieval quality.
 * Run with: npm run test:integration -- goldenQuestions.test.ts
 */

import request from 'supertest';
import express, { Express } from 'express';
import ragRoutes from '../../src/routes/rag';
import { errorHandler } from '../../src/middleware/errorHandler';
import * as database from '../../src/config/database';

// This test is marked as skip by default - only run when explicitly testing golden questions
const describeGolden = process.env.RUN_GOLDEN_TESTS === 'true' ? describe : describe.skip;

/**
 * Golden Question definition
 * Represents a curated question with expected characteristics
 */
interface GoldenQuestion {
  question: string;
  expectedKeywords: string[]; // Keywords that MUST appear in answer
  expectedSources: {
    pageNumber: number;
    sectionHeading: string;
  }[];
  minimumRelevanceScore: number; // Minimum similarity score for top result
  description: string; // What this question tests
}

/**
 * Golden questions for booklet.pdf (RPG character types)
 * Each question tests different aspects of RAG retrieval quality
 */
const goldenQuestions: GoldenQuestion[] = [
  {
    question: 'What are the unbreakable rules for the Fox?',
    description: 'Tests multi-part list retrieval and specific rules extraction',
    expectedKeywords: [
      'answer direct questions',
      'accept any gift',
      'invited guests',
    ],
    expectedSources: [{ pageNumber: 2, sectionHeading: 'FOX' }],
    minimumRelevanceScore: 0.7,
  },
  {
    question: 'What items does the Piper start with?',
    description: 'Tests starting equipment list retrieval',
    expectedKeywords: ['fine flute', 'reeds', 'music'],
    expectedSources: [{ pageNumber: 4, sectionHeading: 'PIPER' }],
    minimumRelevanceScore: 0.7,
  },
  {
    question: "What is the Black Hound's Name Scent ability?",
    description: 'Tests specific ability description retrieval',
    expectedKeywords: ['true name', 'kin name', 'follow', 'glamour'],
    expectedSources: [{ pageNumber: 8, sectionHeading: 'BLACK HOUND' }],
    minimumRelevanceScore: 0.7,
  },
  {
    question: 'What special abilities does the Wisp have?',
    description: 'Tests ability list retrieval for a character type',
    expectedKeywords: ['light', 'illuminate', 'darkness'],
    expectedSources: [{ pageNumber: 10, sectionHeading: 'WISP' }],
    minimumRelevanceScore: 0.65,
  },
  {
    question: 'What contacts does the Drowned Bride start with?',
    description: 'Tests contact/NPC list retrieval',
    expectedKeywords: ['contact', 'relationship'],
    expectedSources: [{ pageNumber: 6, sectionHeading: 'DROWNED BRIDE' }],
    minimumRelevanceScore: 0.7,
  },
  {
    question: 'How does the Gremlin create mischief?',
    description: 'Tests mechanic/rule description retrieval',
    expectedKeywords: ['mischief', 'trick', 'chaos'],
    expectedSources: [{ pageNumber: 9, sectionHeading: 'GREMLIN' }],
    minimumRelevanceScore: 0.65,
  },
  {
    question: 'What is unique about the House Elf compared to other character types?',
    description: 'Tests comparative/analytical retrieval',
    expectedKeywords: ['house', 'elf', 'domestic'],
    expectedSources: [{ pageNumber: 12, sectionHeading: 'HOUSE ELF' }],
    minimumRelevanceScore: 0.6,
  },
  {
    question: 'What happens if the Bogeyman is exposed to light?',
    description: 'Tests conditional/consequence retrieval',
    expectedKeywords: ['light', 'weakness', 'shadow', 'darkness'],
    expectedSources: [{ pageNumber: 11, sectionHeading: 'BOGEYMAN' }],
    minimumRelevanceScore: 0.65,
  },
];

describeGolden('Golden Questions RAG Evaluation', () => {
  let app: Express;
  let authToken: string;
  let campaignId: string;

  beforeAll(async () => {
    // This test requires real database and OpenAI API
    // Verify environment is set up
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY must be set to run golden questions tests');
    }

    if (!process.env.DATABASE_URL && !process.env.DB_TEST_URL) {
      throw new Error('Database URL must be set to run golden questions tests');
    }

    // Create Express app
    app = express();
    app.use(express.json());

    const apiRouter = express.Router();
    apiRouter.use('/', ragRoutes);

    app.use('/api', apiRouter);
    app.use(errorHandler);

    // Initialize real database connection
    await database.initDatabase();

    // TODO: Set up test user and campaign with booklet.pdf
    // For now, use environment variables
    campaignId = process.env.TEST_CAMPAIGN_ID || 'test-campaign-id';
    authToken = process.env.TEST_AUTH_TOKEN || 'test-token';
  });

  afterAll(async () => {
    // Clean up database connection
    await database.closeDatabase();
  });

  describe('Golden Question Quality Tests', () => {
    goldenQuestions.forEach((gq, index) => {
      it(`should answer golden question ${index + 1}: ${gq.description}`, async () => {
        const response = await request(app)
          .post(`/api/campaigns/${campaignId}/rag/query`)
          .set('Authorization', `Bearer ${authToken}`)
          .send({ query: gq.question })
          .expect(200);

        // Test 1: Response structure
        expect(response.body).toHaveProperty('queryId');
        expect(response.body).toHaveProperty('answer');
        expect(response.body).toHaveProperty('sources');
        expect(response.body).toHaveProperty('metadata');

        const { answer, sources, metadata } = response.body;

        // Test 2: Answer contains expected keywords
        const answerLower = answer.toLowerCase();
        const missingKeywords = gq.expectedKeywords.filter(
          (keyword) => !answerLower.includes(keyword.toLowerCase())
        );

        expect(missingKeywords).toEqual([]);

        // If keywords are missing, log detailed info
        if (missingKeywords.length > 0) {
          console.error(`\nGolden Question ${index + 1} FAILED:`);
          console.error(`Question: ${gq.question}`);
          console.error(`Missing keywords: ${missingKeywords.join(', ')}`);
          console.error(`Answer received:\n${answer}\n`);
        }

        // Test 3: Answer includes citations
        expect(answer).toMatch(/\[Page \d+/);

        // Test 4: Expected sources are cited
        gq.expectedSources.forEach((expectedSource) => {
          const matchingSource = sources.find(
            (s: any) =>
              s.pageNumber === expectedSource.pageNumber &&
              s.sectionHeading &&
              s.sectionHeading.includes(expectedSource.sectionHeading)
          );

          expect(matchingSource).toBeDefined();

          if (!matchingSource) {
            console.error(`\nExpected source not found:`);
            console.error(`  Page: ${expectedSource.pageNumber}`);
            console.error(`  Section: ${expectedSource.sectionHeading}`);
            console.error(`Sources received:`, sources);
          }
        });

        // Test 5: Top result meets minimum relevance threshold
        expect(sources.length).toBeGreaterThan(0);
        expect(sources[0].similarityScore).toBeGreaterThan(
          gq.minimumRelevanceScore
        );

        // Test 6: Verify expected source has high relevance
        gq.expectedSources.forEach((expectedSource) => {
          const matchingSource = sources.find(
            (s: any) =>
              s.pageNumber === expectedSource.pageNumber &&
              s.sectionHeading &&
              s.sectionHeading.includes(expectedSource.sectionHeading)
          );

          if (matchingSource) {
            expect(matchingSource.similarityScore).toBeGreaterThan(
              gq.minimumRelevanceScore
            );
          }
        });

        // Test 7: Performance - latency under 2 seconds
        expect(metadata.latencyMs).toBeLessThan(2000);

        // Test 8: Reasonable token usage
        expect(metadata.promptTokens).toBeGreaterThan(0);
        expect(metadata.completionTokens).toBeGreaterThan(0);
        expect(metadata.promptTokens).toBeLessThan(4000); // Context shouldn't be huge
        expect(metadata.completionTokens).toBeLessThan(1500); // Answer shouldn't be huge

        // Log success metrics for analysis
        console.log(`\n✓ Golden Question ${index + 1} PASSED`);
        console.log(`  Question: ${gq.question}`);
        console.log(`  Top relevance: ${sources[0].similarityScore.toFixed(4)}`);
        console.log(`  Latency: ${metadata.latencyMs}ms`);
        console.log(`  Tokens: ${metadata.promptTokens}p + ${metadata.completionTokens}c`);
      }, 10000); // 10 second timeout per question
    });
  });

  describe('Aggregate Quality Metrics', () => {
    it('should achieve 90%+ correctness across all golden questions', async () => {
      let passedQuestions = 0;
      const results: any[] = [];

      for (const gq of goldenQuestions) {
        try {
          const response = await request(app)
            .post(`/api/campaigns/${campaignId}/rag/query`)
            .set('Authorization', `Bearer ${authToken}`)
            .send({ query: gq.question });

          const { answer, sources } = response.body;

          // Check keyword presence
          const answerLower = answer.toLowerCase();
          const keywordsPresent = gq.expectedKeywords.filter((keyword) =>
            answerLower.includes(keyword.toLowerCase())
          ).length;

          const keywordScore = keywordsPresent / gq.expectedKeywords.length;

          // Check source accuracy
          const sourcesFound = gq.expectedSources.filter((expectedSource) =>
            sources.some(
              (s: any) =>
                s.pageNumber === expectedSource.pageNumber &&
                s.sectionHeading &&
                s.sectionHeading.includes(expectedSource.sectionHeading)
            )
          ).length;

          const sourceScore = sourcesFound / gq.expectedSources.length;

          // Check relevance
          const topRelevance = sources[0]?.similarityScore || 0;
          const relevanceScore =
            topRelevance >= gq.minimumRelevanceScore ? 1 : 0;

          // Overall score (average of all metrics)
          const overallScore = (keywordScore + sourceScore + relevanceScore) / 3;

          results.push({
            question: gq.question,
            keywordScore,
            sourceScore,
            relevanceScore,
            overallScore,
            passed: overallScore >= 0.7,
          });

          if (overallScore >= 0.7) {
            passedQuestions++;
          }
        } catch (error) {
          results.push({
            question: gq.question,
            error: error instanceof Error ? error.message : String(error),
            passed: false,
          });
        }
      }

      const successRate = passedQuestions / goldenQuestions.length;

      // Log detailed results
      console.log('\n=== Golden Questions Aggregate Results ===');
      results.forEach((result, i) => {
        console.log(`\n${i + 1}. ${result.question}`);
        if (result.error) {
          console.log(`   ERROR: ${result.error}`);
        } else {
          console.log(`   Keyword Score: ${(result.keywordScore * 100).toFixed(0)}%`);
          console.log(`   Source Score: ${(result.sourceScore * 100).toFixed(0)}%`);
          console.log(`   Relevance Score: ${(result.relevanceScore * 100).toFixed(0)}%`);
          console.log(`   Overall Score: ${(result.overallScore * 100).toFixed(0)}%`);
          console.log(`   Status: ${result.passed ? '✓ PASS' : '✗ FAIL'}`);
        }
      });

      console.log(`\n=== Summary ===`);
      console.log(`Passed: ${passedQuestions}/${goldenQuestions.length}`);
      console.log(`Success Rate: ${(successRate * 100).toFixed(1)}%`);
      console.log(`Target: 90%+\n`);

      // Assert 90%+ success rate
      expect(successRate).toBeGreaterThanOrEqual(0.9);
    }, 120000); // 2 minute timeout for all questions
  });

  describe('Hybrid Search Comparison', () => {
    it('should demonstrate hybrid search outperforms vector-only search', async () => {
      // This test would require adding a search mode parameter to the API
      // For now, it's a placeholder for future enhancement

      // TODO: Implement vector-only vs hybrid search comparison
      // Expected: hybrid search should have higher relevance scores for top results

      expect(true).toBe(true); // Placeholder
    });
  });
});

/**
 * Test data setup instructions
 *
 * To run this test suite:
 *
 * 1. Set up test environment:
 *    export RUN_GOLDEN_TESTS=true
 *    export OPENAI_API_KEY=your-key
 *    export DATABASE_URL=your-test-db-url
 *
 * 2. Create test user and campaign:
 *    - Create test user account
 *    - Create test campaign
 *    - Upload booklet.pdf to campaign
 *    - Wait for processing to complete
 *
 * 3. Set test IDs:
 *    export TEST_USER_ID=your-user-id
 *    export TEST_CAMPAIGN_ID=your-campaign-id
 *    export TEST_AUTH_TOKEN=your-auth-token
 *
 * 4. Run tests:
 *    npm run test:integration -- goldenQuestions.test.ts
 */
