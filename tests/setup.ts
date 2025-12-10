/**
 * Test setup and teardown
 * Initializes test database and Redis connection
 */

import logger from '../src/utils/logger';

// Disable logging during tests
logger.silent = true;

beforeAll(async () => {
  // Set test environment
  process.env.NODE_ENV = 'test';

  // Mock database and Redis will be set up in individual test files
  // This allows for better test isolation and control
});

afterAll(async () => {
  // Cleanup is handled by individual test files
});

// Clean up between tests
afterEach(async () => {
  // Clear all mocks
  jest.clearAllMocks();
});
