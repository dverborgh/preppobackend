/**
 * Generator designer service
 * Uses LLM with Structured Outputs to design generators from natural language
 */

import { ExtendedDatabase } from '../config/database';
import { ValidationError } from '../types';
import logger from '../utils/logger';
import { llmService, ChatMessage } from './llmService';
import { createGenerator, CreateGeneratorData } from './generatorService';

// Design request types
export interface GeneratorDesignRequest {
  natural_language_spec: string;
  system_name?: string;
  session_id?: string;
}

// JSON Schema for Structured Outputs
const generatorDesignSchema = {
  type: 'object',
  properties: {
    name: {
      type: 'string',
      description: 'Name only - DO NOT include the word "generator" (concise, descriptive)',
    },
    description: {
      type: 'string',
      description: 'Generator description (what it generates)',
    },
    output_schema: {
      type: 'object',
      description: 'JSON Schema for the output structure',
      properties: {
        type: { type: 'string', enum: ['object'] },
        properties: {
          type: 'object',
          additionalProperties: false,
        },
        required: { type: 'array', items: { type: 'string' } },
      },
      required: ['type', 'required'],
      additionalProperties: false,
    },
    output_example: {
      type: 'object',
      description: 'Example output conforming to the schema',
      additionalProperties: false,
    },
    tables: {
      type: 'array',
      description: 'Roll tables with weighted entries',
      items: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Table name',
          },
          entries: {
            type: 'array',
            description: 'Weighted entries - create as many as the user requests',
            items: {
              type: 'object',
              properties: {
                entry_key: {
                  type: 'string',
                  description: 'Unique key for this entry (snake_case)',
                },
                entry_text: {
                  type: 'string',
                  description: 'Text description and JSON output in format: "Description {json}"',
                },
                weight: {
                  type: 'integer',
                  description: 'Weight (1-100, higher = more common)',
                  minimum: 1,
                  maximum: 100,
                },
              },
              required: ['entry_key', 'entry_text', 'weight'],
              additionalProperties: false,
            },
            minItems: 1,
            maxItems: 100,
          },
        },
        required: ['name', 'entries'],
        additionalProperties: false,
      },
      minItems: 1,
      maxItems: 1, // MVP: single table only
    },
  },
  required: ['name', 'description', 'output_schema', 'tables'],
  additionalProperties: false,
} as const;

/**
 * Build system prompt for generator design
 */
function buildSystemPrompt(systemName?: string): string {
  const systemContext = systemName
    ? `The generator is for a ${systemName} tabletop RPG campaign.`
    : 'The generator is for a tabletop RPG campaign.';

  return `You are an expert random table generator for tabletop RPGs. ${systemContext}

CRITICAL DESIGN PRINCIPLES (DO NOT DEVIATE FROM THESE):
1. Create balanced entries that match user intent
2. Include diverse, creative options that GMs will actually use during play
3. Ensure all output data conforms EXACTLY to the provided JSON Schema
4. Use descriptive entry_text that GMs can read aloud if needed
5. Weight higher = more common (e.g., common items = 60-80, rare = 20-30, legendary = 5-10)
6. Create the number of entries the user requests - if they ask for 100, create 100 unique entries, this is CRITICAL
7. Make entry_key values snake_case and descriptive (e.g., "common_sword", "rare_dragon")
8. DO NOT include the word "generator" in the name field
9. DO NOT use different weighing for the entries, unless the user asks for it

OUTPUT FORMAT (CRITICAL FOR PROPER FUNCTIONALITY, DO NOT DEVIATE):
- entry_text should contain both a description AND the JSON data in format: "Description text {json}"
- Example: "A rusty iron sword {\\\"name\\\": \\\"Rusty Sword\\\", \\\"damage\\\": \\\"1d6\\\", \\\"value\\\": 5}"
- The JSON in entry_text MUST match the output_schema

WEIGHT GUIDELINES (ONLY IF WEIGHING IS MENTIONED IN THE USER PROMPT OTHERWISE MAKE IT UNIFORM):
- Very common (60-80): Everyday occurrences, basic items
- Common (30-50): Frequent but not constant
- Uncommon (20-30): Happens occasionally
- Rare (10-20): Special moments
- Very rare (5-10): Memorable events
- Legendary (1-5): Once per campaign moments

Create generators that enhance gameplay and spark GM creativity!`;
}

/**
 * Design a generator from natural language specification
 * Uses OpenAI GPT-5 (or GPT-4o) with Structured Outputs
 * Target latency: < 5 seconds (p95)
 */
//TODO: ADD CONTEXT FROM CAMPAIGN/SESSION NOTES
export async function designGenerator(
  _db: ExtendedDatabase,
  userId: string,
  campaignId: string,
  sessionId: string|undefined,
  request: GeneratorDesignRequest
): Promise<CreateGeneratorData> {
  const startTime = Date.now();

  // Validate input
  if (!request.natural_language_spec || request.natural_language_spec.trim().length === 0) {
    throw new ValidationError('Natural language specification is required');
  }

  if (request.natural_language_spec.trim().length > 2000) {
    throw new ValidationError('Specification must not exceed 2000 characters');
  }

  // Sanitize input (prevent prompt injection)
  const sanitizedSpec = request.natural_language_spec
    .trim()
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ''); // Remove control characters

  logger.info('Designing generator with LLM', {
    user_id: userId,
    campaign_id: campaignId,
    session_id: sessionId,
    spec_length: sanitizedSpec.length,
    system_name: request.system_name,
  });

  try {
    // Call LLM with Structured Outputs (uses OpenAI by default for strict JSON schema support)
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: buildSystemPrompt(request.system_name),
      },
      {
        role: 'user',
        content: `Design a random generator for: ${sanitizedSpec}`,
      },
    ];

    const completion = await llmService.complete(
      messages,
      llmService.getModel('generatorDesign'),
      {
        temperature: 0.7,
        maxTokens: 12000, // Increased from 4000 to prevent truncation
        responseSchema: {
          name: 'generator_design',
          strict: true,
          schema: generatorDesignSchema,
        },
      },
      'openai' // Force OpenAI for structured outputs (Gemini doesn't support strict JSON schemas yet)
    );

    const latency = Date.now() - startTime;

    // Parse response
    const responseContent = completion.content;
    if (!responseContent) {
      throw new Error('Empty response from LLM');
    }

    const designData = JSON.parse(responseContent);

    // Log success metrics
    logger.info('Generator designed successfully', {
      user_id: userId,
      campaign_id: campaignId,
      session_id: sessionId,
      name: designData.name,
      table_count: designData.tables.length,
      entry_count: designData.tables.reduce((sum: number, t: any) => sum + t.entries.length, 0),
      latency_ms: latency,
      tokens_used: completion.promptTokens + completion.completionTokens,
      prompt_tokens: completion.promptTokens,
      completion_tokens: completion.completionTokens,
      model: completion.model,
    });

    // Convert to CreateGeneratorData format
    const generatorData: CreateGeneratorData = {
      name: designData.name,
      description: designData.description,
      mode: 'table',
      output_schema: designData.output_schema,
      output_example: designData.output_example,
      created_by_prompt: sanitizedSpec,
      tables: designData.tables.map((table: any) => ({
        name: table.name,
        description: table.description || undefined,
        roll_method: 'weighted_random' as const,
        entries: table.entries.map((entry: any) => ({
          entry_key: entry.entry_key,
          entry_text: entry.entry_text,
          weight: entry.weight,
        })),
      })),
    };

    return generatorData;
  } catch (error: any) {
    const latency = Date.now() - startTime;

    logger.error('Generator design failed', {
      user_id: userId,
      campaign_id: campaignId,
      session_id: sessionId,
      error: error.message,
      latency_ms: latency,
    });

    // Handle OpenAI API errors
    if (error.response) {
      const status = error.response.status;
      if (status === 429) {
        throw new ValidationError('Rate limit exceeded. Please try again in a moment.');
      } else if (status === 400) {
        throw new ValidationError('Invalid request to AI service. Please simplify your specification.');
      } else if (status === 500 || status === 503) {
        throw new ValidationError('AI service temporarily unavailable. Please try again.');
      }
    }

    // Re-throw as validation error
    throw new ValidationError(
      `Failed to design generator: ${error.message || 'Unknown error'}`
    );
  }
}

/**
 * Design and create a generator in one operation
 * Combines designGenerator + createGenerator in a single transaction
 */
export async function designAndCreateGenerator(
  db: ExtendedDatabase,
  userId: string,
  campaignId: string,
  sessionId: string|undefined,
  request: GeneratorDesignRequest
) {
  // Design generator using LLM
  const generatorData = await designGenerator(db, userId, campaignId, sessionId, request);

  // Create generator in database
  const generator = await createGenerator(db, userId, campaignId, sessionId, generatorData);

  logger.info('Generator designed and created', {
    generator_id: generator.id,
    campaign_id: campaignId,
    user_id: userId,
    name: generator.name,
  });

  return generator;
}
