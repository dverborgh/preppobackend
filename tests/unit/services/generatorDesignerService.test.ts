/**
 * Unit tests for generator designer service
 */

// Mock OpenAI and config BEFORE any imports
const mockOpenAI = {
  chat: {
    completions: {
      create: jest.fn(),
    },
  },
};

jest.mock('openai', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => mockOpenAI),
  };
});
jest.mock('../../../src/config', () => ({
  __esModule: true,
  default: {
    server: {
      nodeEnv: 'test',
      port: 8000,
      apiBaseUrl: '/api',
    },
    openai: {
      apiKey: 'test-openai-key',
      orgId: '',
      models: {
        orchestrator: 'gpt-4o',
        ragQA: 'gpt-4-turbo-preview',
        generatorDesign: 'gpt-4o-mini',
        musicRecipe: 'gpt-4o-mini',
        embedding: 'text-embedding-3-small',
      },
    },
    logging: {
      filePath: '/tmp/test-logs/app.log',
      level: 'info',
    },
  },
}));
jest.mock('../../../src/utils/logger', () => ({
  default: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  logLLMCall: jest.fn(),
  logGeneratorRoll: jest.fn(),
  logRAGQuery: jest.fn(),
  logAPIRequest: jest.fn(),
  logSecurityEvent: jest.fn(),
  logPerformance: jest.fn(),
}));
jest.mock('../../../src/services/generatorService');

import * as generatorDesignerService from '../../../src/services/generatorDesignerService';
import * as generatorService from '../../../src/services/generatorService';
import { ValidationError } from '../../../src/types';

const mockDb = {} as any;

describe('Generator Designer Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('designGenerator', () => {
    it('should design a generator successfully', async () => {
      const mockResponse = {
        name: 'Random Tavern Name Generator',
        description: 'Generates creative tavern names for your fantasy world',
        output_schema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            description: { type: 'string' },
          },
          required: ['name'],
        },
        output_example: {
          name: 'The Prancing Pony',
          description: 'A cozy inn on the main road',
        },
        tables: [
          {
            name: 'main_table',
            description: 'Main tavern name table',
            entries: [
              {
                entry_key: 'prancing_pony',
                entry_text: 'The Prancing Pony {"name": "The Prancing Pony", "description": "A cozy inn"}',
                weight: 50,
              },
              {
                entry_key: 'golden_griffin',
                entry_text: 'The Golden Griffin {"name": "The Golden Griffin", "description": "An upscale establishment"}',
                weight: 30,
              },
            ],
          },
        ],
      };

      mockOpenAI.chat.completions.create.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify(mockResponse),
            },
          },
        ],
        usage: {
          total_tokens: 500,
        },
        model: 'gpt-4o-mini',
      });

      const result = await generatorDesignerService.designGenerator(
        mockDb,
        'user-123',
        'campaign-123',
        {
          natural_language_spec: 'Create a tavern name generator',
          system_name: 'D&D 5e',
        }
      );

      expect(result).toEqual({
        name: 'Random Tavern Name Generator',
        description: 'Generates creative tavern names for your fantasy world',
        mode: 'table',
        output_schema: expect.any(Object),
        output_example: expect.any(Object),
        created_by_prompt: 'Create a tavern name generator',
        tables: [
          {
            name: 'main_table',
            description: 'Main tavern name table',
            roll_method: 'weighted_random',
            entries: [
              {
                entry_key: 'prancing_pony',
                entry_text: expect.stringContaining('Prancing Pony'),
                weight: 50,
              },
              {
                entry_key: 'golden_griffin',
                entry_text: expect.stringContaining('Golden Griffin'),
                weight: 30,
              },
            ],
          },
        ],
      });

      // Verify OpenAI was called correctly
      expect(mockOpenAI.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          model: expect.any(String),
          messages: [
            expect.objectContaining({
              role: 'system',
              content: expect.stringContaining('D&D 5e'),
            }),
            expect.objectContaining({
              role: 'user',
              content: 'Design a random generator for: Create a tavern name generator',
            }),
          ],
          response_format: expect.objectContaining({
            type: 'json_schema',
          }),
        })
      );
    });

    it('should throw ValidationError for empty specification', async () => {
      await expect(
        generatorDesignerService.designGenerator(mockDb, 'user-123', 'campaign-123', {
          natural_language_spec: '',
        })
      ).rejects.toThrow(ValidationError);

      await expect(
        generatorDesignerService.designGenerator(mockDb, 'user-123', 'campaign-123', {
          natural_language_spec: '   ',
        })
      ).rejects.toThrow('Natural language specification is required');
    });

    it('should throw ValidationError for spec exceeding 2000 characters', async () => {
      const longSpec = 'a'.repeat(2001);

      await expect(
        generatorDesignerService.designGenerator(mockDb, 'user-123', 'campaign-123', {
          natural_language_spec: longSpec,
        })
      ).rejects.toThrow('Specification must not exceed 2000 characters');
    });

    it('should sanitize control characters from input', async () => {
      const dirtySpec = 'Create generator\x00\x1F\x7Fwith special chars';

      mockOpenAI.chat.completions.create.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                name: 'Test Generator',
                description: 'Test',
                output_schema: { type: 'object', properties: {} },
                output_example: {},
                tables: [
                  {
                    name: 'test',
                    entries: [{ entry_key: 'test', entry_text: 'test', weight: 50 }],
                  },
                ],
              }),
            },
          },
        ],
        usage: { total_tokens: 100 },
        model: 'gpt-4o-mini',
      });

      await generatorDesignerService.designGenerator(
        mockDb,
        'user-123',
        'campaign-123',
        {
          natural_language_spec: dirtySpec,
        }
      );

      // Verify sanitized spec was used
      expect(mockOpenAI.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: 'user',
              content: expect.not.stringContaining('\x00'),
            }),
          ]),
        })
      );
    });

    it('should handle empty OpenAI response', async () => {
      mockOpenAI.chat.completions.create.mockResolvedValue({
        choices: [
          {
            message: {
              content: null,
            },
          },
        ],
      });

      await expect(
        generatorDesignerService.designGenerator(mockDb, 'user-123', 'campaign-123', {
          natural_language_spec: 'Create generator',
        })
      ).rejects.toThrow('Empty response from OpenAI');
    });

    it('should handle OpenAI rate limit error (429)', async () => {
      const error: any = new Error('Rate limit exceeded');
      error.response = { status: 429 };
      mockOpenAI.chat.completions.create.mockRejectedValue(error);

      await expect(
        generatorDesignerService.designGenerator(mockDb, 'user-123', 'campaign-123', {
          natural_language_spec: 'Create generator',
        })
      ).rejects.toThrow('Rate limit exceeded. Please try again in a moment.');
    });

    it('should handle OpenAI bad request error (400)', async () => {
      const error: any = new Error('Bad request');
      error.response = { status: 400 };
      mockOpenAI.chat.completions.create.mockRejectedValue(error);

      await expect(
        generatorDesignerService.designGenerator(mockDb, 'user-123', 'campaign-123', {
          natural_language_spec: 'Create generator',
        })
      ).rejects.toThrow('Invalid request to AI service');
    });

    it('should handle OpenAI server error (500)', async () => {
      const error: any = new Error('Server error');
      error.response = { status: 500 };
      mockOpenAI.chat.completions.create.mockRejectedValue(error);

      await expect(
        generatorDesignerService.designGenerator(mockDb, 'user-123', 'campaign-123', {
          natural_language_spec: 'Create generator',
        })
      ).rejects.toThrow('AI service temporarily unavailable');
    });

    it('should handle OpenAI service unavailable error (503)', async () => {
      const error: any = new Error('Service unavailable');
      error.response = { status: 503 };
      mockOpenAI.chat.completions.create.mockRejectedValue(error);

      await expect(
        generatorDesignerService.designGenerator(mockDb, 'user-123', 'campaign-123', {
          natural_language_spec: 'Create generator',
        })
      ).rejects.toThrow('AI service temporarily unavailable');
    });

    it('should handle generic OpenAI error', async () => {
      mockOpenAI.chat.completions.create.mockRejectedValue(
        new Error('Network error')
      );

      await expect(
        generatorDesignerService.designGenerator(mockDb, 'user-123', 'campaign-123', {
          natural_language_spec: 'Create generator',
        })
      ).rejects.toThrow(ValidationError);
    });

    it('should work without system_name', async () => {
      mockOpenAI.chat.completions.create.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                name: 'Generic Generator',
                description: 'A generic generator',
                output_schema: { type: 'object', properties: {} },
                output_example: {},
                tables: [
                  {
                    name: 'test',
                    entries: [{ entry_key: 'test', entry_text: 'test', weight: 50 }],
                  },
                ],
              }),
            },
          },
        ],
        usage: { total_tokens: 100 },
        model: 'gpt-4o-mini',
      });

      await generatorDesignerService.designGenerator(
        mockDb,
        'user-123',
        'campaign-123',
        {
          natural_language_spec: 'Create generator',
        }
      );

      // Verify system prompt doesn't include specific system
      expect(mockOpenAI.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: 'system',
              content: expect.stringContaining('generic tabletop RPG'),
            }),
          ]),
        })
      );
    });

    it('should handle tables without description', async () => {
      mockOpenAI.chat.completions.create.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                name: 'Test Generator',
                description: 'Test',
                output_schema: { type: 'object', properties: {} },
                output_example: {},
                tables: [
                  {
                    name: 'test_table',
                    // No description field
                    entries: [{ entry_key: 'test', entry_text: 'test', weight: 50 }],
                  },
                ],
              }),
            },
          },
        ],
        usage: { total_tokens: 100 },
        model: 'gpt-4o-mini',
      });

      const result = await generatorDesignerService.designGenerator(
        mockDb,
        'user-123',
        'campaign-123',
        {
          natural_language_spec: 'Create generator',
        }
      );

      expect(result.tables?.[0]?.description).toBeUndefined();
    });
  });

  describe('designAndCreateGenerator', () => {
    it('should design and create generator in one operation', async () => {
      mockOpenAI.chat.completions.create.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                name: 'Test Generator',
                description: 'Test description',
                output_schema: { type: 'object', properties: {} },
                output_example: {},
                tables: [
                  {
                    name: 'test',
                    entries: [{ entry_key: 'test', entry_text: 'test', weight: 50 }],
                  },
                ],
              }),
            },
          },
        ],
        usage: { total_tokens: 100 },
        model: 'gpt-4o-mini',
      });

      const mockCreatedGenerator = {
        id: 'gen-123',
        name: 'Test Generator',
        description: 'Test description',
      };

      (generatorService.createGenerator as jest.Mock).mockResolvedValue(
        mockCreatedGenerator
      );

      const result = await generatorDesignerService.designAndCreateGenerator(
        mockDb,
        'user-123',
        'campaign-123',
        {
          natural_language_spec: 'Create a test generator',
        }
      );

      expect(result).toEqual(mockCreatedGenerator);
      expect(generatorService.createGenerator).toHaveBeenCalledWith(
        mockDb,
        'user-123',
        'campaign-123',
        expect.objectContaining({
          name: 'Test Generator',
          description: 'Test description',
          mode: 'table',
        })
      );
    });

    it('should propagate design errors', async () => {
      mockOpenAI.chat.completions.create.mockRejectedValue(
        new Error('Design failed')
      );

      await expect(
        generatorDesignerService.designAndCreateGenerator(
          mockDb,
          'user-123',
          'campaign-123',
          {
            natural_language_spec: 'Create generator',
          }
        )
      ).rejects.toThrow(ValidationError);

      expect(generatorService.createGenerator).not.toHaveBeenCalled();
    });

    it('should propagate creation errors', async () => {
      mockOpenAI.chat.completions.create.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                name: 'Test Generator',
                description: 'Test',
                output_schema: { type: 'object', properties: {} },
                output_example: {},
                tables: [
                  {
                    name: 'test',
                    entries: [{ entry_key: 'test', entry_text: 'test', weight: 50 }],
                  },
                ],
              }),
            },
          },
        ],
        usage: { total_tokens: 100 },
        model: 'gpt-4o-mini',
      });

      (generatorService.createGenerator as jest.Mock).mockRejectedValue(
        new Error('Database error')
      );

      await expect(
        generatorDesignerService.designAndCreateGenerator(
          mockDb,
          'user-123',
          'campaign-123',
          {
            natural_language_spec: 'Create generator',
          }
        )
      ).rejects.toThrow('Database error');
    });
  });
});
