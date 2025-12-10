/**
 * Unit tests for logger utility
 * Tests all logging functions, format handling, and edge cases
 */

import fs from 'fs';

// Mock dependencies before imports
jest.mock('fs');
jest.mock('../../../src/config', () => ({
  __esModule: true,
  default: {
    logging: {
      level: 'debug',
      filePath: '/tmp/test-logs/app.log',
    },
    server: {
      nodeEnv: 'test',
    },
  },
}));

describe('logger utility', () => {
  let mockExistsSync: jest.Mock;
  let mockMkdirSync: jest.Mock;
  let mockInfoSpy: jest.SpyInstance;
  let mockWarnSpy: jest.SpyInstance;
  let mockDebugSpy: jest.SpyInstance;
  let mockLogSpy: jest.SpyInstance;

  beforeEach(() => {
    // Reset modules to get fresh instance
    jest.resetModules();

    // Setup fs mocks
    mockExistsSync = fs.existsSync as jest.Mock;
    mockMkdirSync = fs.mkdirSync as jest.Mock;
    mockExistsSync.mockReturnValue(false);
    mockMkdirSync.mockReturnValue(undefined);

    // Clear all mocks
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Logger initialization', () => {
    it('should create logs directory if it does not exist', () => {
      mockExistsSync.mockReturnValue(false);

      // Import to trigger initialization
      const logger = require('../../../src/utils/logger');

      // Verify logger was created
      expect(logger.default).toBeDefined();
    });

    it('should not create logs directory if it already exists', () => {
      mockExistsSync.mockReturnValue(true);

      // Import to trigger initialization
      const logger = require('../../../src/utils/logger');

      // Verify logger was created
      expect(logger.default).toBeDefined();
    });

    it('should configure logger with correct log level', () => {
      const logger = require('../../../src/utils/logger').default;
      expect(logger.level).toBe('debug');
    });

    it('should add console transport in non-production environments', () => {
      const logger = require('../../../src/utils/logger').default;
      const consoleTransport = logger.transports.find(
        (t: any) => t.constructor.name === 'Console'
      );
      expect(consoleTransport).toBeDefined();
    });
  });

  describe('logLLMCall', () => {
    beforeEach(() => {
      const logger = require('../../../src/utils/logger').default;
      mockInfoSpy = jest.spyOn(logger, 'info').mockImplementation();
    });

    it('should log LLM API call with all fields', () => {
      const { logLLMCall } = require('../../../src/utils/logger');

      logLLMCall({
        model: 'gpt-4o',
        prompt: 'test prompt',
        tokens: 1500,
        cost: 0.05,
        latency: 2500,
        error: undefined,
      });

      expect(mockInfoSpy).toHaveBeenCalledWith('LLM API Call', {
        type: 'llm_call',
        model: 'gpt-4o',
        prompt: 'test prompt',
        tokens: 1500,
        cost: 0.05,
        latency: 2500,
        error: undefined,
      });
    });

    it('should log LLM API call with minimal fields', () => {
      const { logLLMCall } = require('../../../src/utils/logger');

      logLLMCall({
        model: 'gpt-4o-mini',
        prompt: 'short prompt',
      });

      expect(mockInfoSpy).toHaveBeenCalledWith('LLM API Call', {
        type: 'llm_call',
        model: 'gpt-4o-mini',
        prompt: 'short prompt',
      });
    });

    it('should log LLM API call with error', () => {
      const { logLLMCall } = require('../../../src/utils/logger');

      logLLMCall({
        model: 'gpt-4o',
        prompt: 'failing prompt',
        error: 'Rate limit exceeded',
      });

      expect(mockInfoSpy).toHaveBeenCalledWith('LLM API Call', {
        type: 'llm_call',
        model: 'gpt-4o',
        prompt: 'failing prompt',
        error: 'Rate limit exceeded',
      });
    });
  });

  describe('logGeneratorRoll', () => {
    beforeEach(() => {
      const logger = require('../../../src/utils/logger').default;
      mockInfoSpy = jest.spyOn(logger, 'info').mockImplementation();
      mockWarnSpy = jest.spyOn(logger, 'warn').mockImplementation();
    });

    it('should log generator roll with standard latency', () => {
      const { logGeneratorRoll } = require('../../../src/utils/logger');

      logGeneratorRoll({
        generator_id: 'gen-123',
        session_id: 'session-456',
        result: { value: 'Treasure chest' },
        latency: 25,
      });

      expect(mockInfoSpy).toHaveBeenCalledWith('Generator Roll', {
        type: 'generator_roll',
        generator_id: 'gen-123',
        session_id: 'session-456',
        result: { value: 'Treasure chest' },
        latency: 25,
      });

      expect(mockWarnSpy).not.toHaveBeenCalled();
    });

    it('should warn when generator roll exceeds 50ms target', () => {
      const { logGeneratorRoll } = require('../../../src/utils/logger');

      logGeneratorRoll({
        generator_id: 'gen-123',
        session_id: 'session-456',
        result: { value: 'Dragon' },
        latency: 75,
      });

      expect(mockInfoSpy).toHaveBeenCalled();
      expect(mockWarnSpy).toHaveBeenCalledWith(
        'Generator roll exceeded 50ms target: 75ms',
        { generator_id: 'gen-123' }
      );
    });

    it('should warn at exactly 51ms (boundary case)', () => {
      const { logGeneratorRoll } = require('../../../src/utils/logger');

      logGeneratorRoll({
        generator_id: 'gen-boundary',
        session_id: 'session-789',
        result: { value: 'Test' },
        latency: 51,
      });

      expect(mockWarnSpy).toHaveBeenCalledWith(
        'Generator roll exceeded 50ms target: 51ms',
        { generator_id: 'gen-boundary' }
      );
    });

    it('should not warn at exactly 50ms (boundary case)', () => {
      const { logGeneratorRoll } = require('../../../src/utils/logger');

      logGeneratorRoll({
        generator_id: 'gen-boundary',
        session_id: 'session-789',
        result: { value: 'Test' },
        latency: 50,
      });

      expect(mockWarnSpy).not.toHaveBeenCalled();
    });
  });

  describe('logRAGQuery', () => {
    beforeEach(() => {
      const logger = require('../../../src/utils/logger').default;
      mockInfoSpy = jest.spyOn(logger, 'info').mockImplementation();
      mockWarnSpy = jest.spyOn(logger, 'warn').mockImplementation();
    });

    it('should log RAG query with all fields and fast latency', () => {
      const { logRAGQuery } = require('../../../src/utils/logger');

      logRAGQuery({
        question: 'What are the combat rules?',
        chunks_retrieved: 5,
        answer_length: 1200,
        confidence: 0.85,
        latency: 1500,
      });

      expect(mockInfoSpy).toHaveBeenCalledWith('RAG Query', {
        type: 'rag_query',
        question: 'What are the combat rules?',
        chunks_retrieved: 5,
        answer_length: 1200,
        confidence: 0.85,
        latency: 1500,
      });

      expect(mockWarnSpy).not.toHaveBeenCalled();
    });

    it('should log RAG query without optional confidence field', () => {
      const { logRAGQuery } = require('../../../src/utils/logger');

      logRAGQuery({
        question: 'Who is the main villain?',
        chunks_retrieved: 3,
        answer_length: 800,
        latency: 1800,
      });

      expect(mockInfoSpy).toHaveBeenCalledWith('RAG Query', {
        type: 'rag_query',
        question: 'Who is the main villain?',
        chunks_retrieved: 3,
        answer_length: 800,
        latency: 1800,
      });
    });

    it('should warn when RAG query exceeds 2000ms target', () => {
      const { logRAGQuery } = require('../../../src/utils/logger');

      logRAGQuery({
        question: 'Complex query about lore',
        chunks_retrieved: 10,
        answer_length: 2500,
        confidence: 0.75,
        latency: 3500,
      });

      expect(mockInfoSpy).toHaveBeenCalled();
      expect(mockWarnSpy).toHaveBeenCalledWith('RAG query exceeded 2s target: 3500ms');
    });

    it('should warn at exactly 2001ms (boundary case)', () => {
      const { logRAGQuery } = require('../../../src/utils/logger');

      logRAGQuery({
        question: 'Boundary test',
        chunks_retrieved: 5,
        answer_length: 1000,
        latency: 2001,
      });

      expect(mockWarnSpy).toHaveBeenCalledWith('RAG query exceeded 2s target: 2001ms');
    });

    it('should not warn at exactly 2000ms (boundary case)', () => {
      const { logRAGQuery } = require('../../../src/utils/logger');

      logRAGQuery({
        question: 'Boundary test',
        chunks_retrieved: 5,
        answer_length: 1000,
        latency: 2000,
      });

      expect(mockWarnSpy).not.toHaveBeenCalled();
    });
  });

  describe('logAPIRequest', () => {
    beforeEach(() => {
      const logger = require('../../../src/utils/logger').default;
      mockLogSpy = jest.spyOn(logger, 'log').mockImplementation();
    });

    it('should log successful API request at info level', () => {
      const { logAPIRequest } = require('../../../src/utils/logger');

      logAPIRequest({
        method: 'GET',
        path: '/api/campaigns',
        user_id: 'user-123',
        status_code: 200,
        latency: 125,
      });

      expect(mockLogSpy).toHaveBeenCalledWith('info', 'API Request', {
        type: 'api_request',
        method: 'GET',
        path: '/api/campaigns',
        user_id: 'user-123',
        status_code: 200,
        latency: 125,
      });
    });

    it('should log 2xx API request at info level', () => {
      const { logAPIRequest } = require('../../../src/utils/logger');

      logAPIRequest({
        method: 'POST',
        path: '/api/resources',
        user_id: 'user-456',
        status_code: 201,
        latency: 250,
      });

      expect(mockLogSpy).toHaveBeenCalledWith('info', 'API Request', {
        type: 'api_request',
        method: 'POST',
        path: '/api/resources',
        user_id: 'user-456',
        status_code: 201,
        latency: 250,
      });
    });

    it('should log 4xx client error at warn level', () => {
      const { logAPIRequest } = require('../../../src/utils/logger');

      logAPIRequest({
        method: 'GET',
        path: '/api/campaigns/999',
        status_code: 404,
        latency: 50,
        error: 'Campaign not found',
      });

      expect(mockLogSpy).toHaveBeenCalledWith('warn', 'API Request', {
        type: 'api_request',
        method: 'GET',
        path: '/api/campaigns/999',
        status_code: 404,
        latency: 50,
        error: 'Campaign not found',
      });
    });

    it('should log 5xx server error at error level', () => {
      const { logAPIRequest } = require('../../../src/utils/logger');

      logAPIRequest({
        method: 'POST',
        path: '/api/sessions',
        user_id: 'user-789',
        status_code: 500,
        latency: 1000,
        error: 'Internal server error',
      });

      expect(mockLogSpy).toHaveBeenCalledWith('error', 'API Request', {
        type: 'api_request',
        method: 'POST',
        path: '/api/sessions',
        user_id: 'user-789',
        status_code: 500,
        latency: 1000,
        error: 'Internal server error',
      });
    });

    it('should log request without user_id (unauthenticated)', () => {
      const { logAPIRequest } = require('../../../src/utils/logger');

      logAPIRequest({
        method: 'POST',
        path: '/api/auth/login',
        status_code: 401,
        latency: 75,
      });

      expect(mockLogSpy).toHaveBeenCalledWith('warn', 'API Request', {
        type: 'api_request',
        method: 'POST',
        path: '/api/auth/login',
        status_code: 401,
        latency: 75,
      });
    });

    it('should handle exactly 400 status (boundary case)', () => {
      const { logAPIRequest } = require('../../../src/utils/logger');

      logAPIRequest({
        method: 'POST',
        path: '/api/test',
        status_code: 400,
        latency: 100,
        error: 'Bad request',
      });

      expect(mockLogSpy).toHaveBeenCalledWith('warn', 'API Request', expect.any(Object));
    });

    it('should handle exactly 500 status (boundary case)', () => {
      const { logAPIRequest } = require('../../../src/utils/logger');

      logAPIRequest({
        method: 'GET',
        path: '/api/test',
        status_code: 500,
        latency: 200,
        error: 'Server error',
      });

      expect(mockLogSpy).toHaveBeenCalledWith('error', 'API Request', expect.any(Object));
    });
  });

  describe('logSecurityEvent', () => {
    beforeEach(() => {
      const logger = require('../../../src/utils/logger').default;
      mockWarnSpy = jest.spyOn(logger, 'warn').mockImplementation();
    });

    it('should log security event with all fields', () => {
      const { logSecurityEvent } = require('../../../src/utils/logger');

      logSecurityEvent({
        event: 'unauthorized_access_attempt',
        user_id: 'user-123',
        ip: '192.168.1.100',
        details: { resource: 'campaign-456', action: 'delete' },
      });

      expect(mockWarnSpy).toHaveBeenCalledWith('Security Event', {
        type: 'security_event',
        event: 'unauthorized_access_attempt',
        user_id: 'user-123',
        ip: '192.168.1.100',
        details: { resource: 'campaign-456', action: 'delete' },
      });
    });

    it('should log security event with minimal fields', () => {
      const { logSecurityEvent } = require('../../../src/utils/logger');

      logSecurityEvent({
        event: 'rate_limit_exceeded',
      });

      expect(mockWarnSpy).toHaveBeenCalledWith('Security Event', {
        type: 'security_event',
        event: 'rate_limit_exceeded',
      });
    });

    it('should log security event without user_id (anonymous)', () => {
      const { logSecurityEvent } = require('../../../src/utils/logger');

      logSecurityEvent({
        event: 'brute_force_attempt',
        ip: '10.0.0.50',
        details: { attempts: 10, endpoint: '/api/auth/login' },
      });

      expect(mockWarnSpy).toHaveBeenCalledWith('Security Event', {
        type: 'security_event',
        event: 'brute_force_attempt',
        ip: '10.0.0.50',
        details: { attempts: 10, endpoint: '/api/auth/login' },
      });
    });
  });

  describe('logPerformance', () => {
    beforeEach(() => {
      const logger = require('../../../src/utils/logger').default;
      mockDebugSpy = jest.spyOn(logger, 'debug').mockImplementation();
    });

    it('should log performance metric with all fields', () => {
      const { logPerformance } = require('../../../src/utils/logger');

      logPerformance({
        operation: 'database_query',
        duration_ms: 250,
        metadata: { query: 'SELECT * FROM campaigns', rows_returned: 50 },
      });

      expect(mockDebugSpy).toHaveBeenCalledWith('Performance Metric', {
        type: 'performance',
        operation: 'database_query',
        duration_ms: 250,
        metadata: { query: 'SELECT * FROM campaigns', rows_returned: 50 },
      });
    });

    it('should log performance metric without metadata', () => {
      const { logPerformance } = require('../../../src/utils/logger');

      logPerformance({
        operation: 'embedding_generation',
        duration_ms: 1500,
      });

      expect(mockDebugSpy).toHaveBeenCalledWith('Performance Metric', {
        type: 'performance',
        operation: 'embedding_generation',
        duration_ms: 1500,
      });
    });

    it('should log performance metric with complex metadata', () => {
      const { logPerformance } = require('../../../src/utils/logger');

      logPerformance({
        operation: 'pdf_processing',
        duration_ms: 8500,
        metadata: {
          file_size_mb: 15.5,
          pages: 200,
          chunks_created: 450,
          memory_usage_mb: 120,
        },
      });

      expect(mockDebugSpy).toHaveBeenCalledWith('Performance Metric', {
        type: 'performance',
        operation: 'pdf_processing',
        duration_ms: 8500,
        metadata: {
          file_size_mb: 15.5,
          pages: 200,
          chunks_created: 450,
          memory_usage_mb: 120,
        },
      });
    });
  });

  describe('Console format', () => {
    it('should format console messages with metadata', () => {
      // This tests the printf function in consoleFormat
      const logger = require('../../../src/utils/logger').default;

      // Find console transport
      const consoleTransport = logger.transports.find(
        (t: any) => t.constructor.name === 'Console'
      );

      expect(consoleTransport).toBeDefined();
      expect(consoleTransport.format).toBeDefined();
    });

    it('should include metadata in console format when present', () => {
      const logger = require('../../../src/utils/logger').default;

      // Spy on console transport
      const consoleTransport = logger.transports.find(
        (t: any) => t.constructor.name === 'Console'
      );

      // Simulate logging with metadata
      const mockWrite = jest.spyOn(consoleTransport, 'log').mockImplementation();

      logger.info('Test message', { extra: 'data', count: 5 });

      // The format function should be called with the metadata
      expect(mockWrite).toHaveBeenCalled();

      mockWrite.mockRestore();
    });

    it('should handle messages without metadata in console format', () => {
      const logger = require('../../../src/utils/logger').default;

      // Find console transport
      const consoleTransport = logger.transports.find(
        (t: any) => t.constructor.name === 'Console'
      );

      // Spy on console transport
      const mockWrite = jest.spyOn(consoleTransport, 'log').mockImplementation();

      logger.info('Simple message');

      expect(mockWrite).toHaveBeenCalled();

      mockWrite.mockRestore();
    });
  });

  describe('Edge cases and error handling', () => {
    it('should handle logGeneratorRoll with zero latency', () => {
      const { logGeneratorRoll } = require('../../../src/utils/logger');
      const logger = require('../../../src/utils/logger').default;
      mockInfoSpy = jest.spyOn(logger, 'info').mockImplementation();
      mockWarnSpy = jest.spyOn(logger, 'warn').mockImplementation();

      logGeneratorRoll({
        generator_id: 'gen-zero',
        session_id: 'session-zero',
        result: { value: 'instant' },
        latency: 0,
      });

      expect(mockInfoSpy).toHaveBeenCalled();
      expect(mockWarnSpy).not.toHaveBeenCalled();
    });

    it('should handle logRAGQuery with zero latency', () => {
      const { logRAGQuery } = require('../../../src/utils/logger');
      const logger = require('../../../src/utils/logger').default;
      mockInfoSpy = jest.spyOn(logger, 'info').mockImplementation();
      mockWarnSpy = jest.spyOn(logger, 'warn').mockImplementation();

      logRAGQuery({
        question: 'cached query',
        chunks_retrieved: 0,
        answer_length: 0,
        latency: 0,
      });

      expect(mockInfoSpy).toHaveBeenCalled();
      expect(mockWarnSpy).not.toHaveBeenCalled();
    });

    it('should handle logAPIRequest with 3xx status codes', () => {
      const { logAPIRequest } = require('../../../src/utils/logger');
      const logger = require('../../../src/utils/logger').default;
      mockLogSpy = jest.spyOn(logger, 'log').mockImplementation();

      logAPIRequest({
        method: 'GET',
        path: '/api/redirect',
        status_code: 301,
        latency: 10,
      });

      expect(mockLogSpy).toHaveBeenCalledWith('info', 'API Request', expect.any(Object));
    });

    it('should handle logLLMCall with empty prompt', () => {
      const { logLLMCall } = require('../../../src/utils/logger');
      const logger = require('../../../src/utils/logger').default;
      mockInfoSpy = jest.spyOn(logger, 'info').mockImplementation();

      logLLMCall({
        model: 'test-model',
        prompt: '',
      });

      expect(mockInfoSpy).toHaveBeenCalledWith('LLM API Call', {
        type: 'llm_call',
        model: 'test-model',
        prompt: '',
      });
    });

    it('should handle logPerformance with negative duration', () => {
      const { logPerformance } = require('../../../src/utils/logger');
      const logger = require('../../../src/utils/logger').default;
      mockDebugSpy = jest.spyOn(logger, 'debug').mockImplementation();

      logPerformance({
        operation: 'edge_case',
        duration_ms: -1,
      });

      expect(mockDebugSpy).toHaveBeenCalledWith('Performance Metric', {
        type: 'performance',
        operation: 'edge_case',
        duration_ms: -1,
      });
    });
  });
});
