/**
 * Track recipe service
 * Handles recipe CRUD operations and LLM-powered recipe design
 */

import { ExtendedDatabase } from '../config/database';
import { NotFoundError, ValidationError, TrackRecipe } from '../types';
import logger from '../utils/logger';
import { llmService, ChatMessage } from './llmService';

// Recipe data types
export interface CreateTrackRecipeData {
  recipe_name: string;
  prompt: string;
  bpm?: number;
  mood_tags?: string[];
  style_tags?: string[];
  instrument_tags?: string[];
  campaign_id?: string;
  session_id?: string;
}

export interface DesignRecipeRequest {
  existing_tags?: string[];
}

// JSON Schema for Structured Outputs
const recipeDesignSchema = {
  type: 'object',
  properties: {
    recipe_name: {
      type: 'string',
      description: 'Descriptive name for the track recipe',
    },
    prompt: {
      type: 'string',
      description: 'Concise music generation prompt (max 200 characters)',
    },
    bpm: {
      type: 'integer',
      description: 'Beats per minute (60-180 range)',
      minimum: 60,
      maximum: 180,
    },
    mood_tags: {
      type: 'array',
      description: 'Mood descriptors (e.g., epic, tense, mysterious)',
      items: { type: 'string' },
      maxItems: 10,
    },
    style_tags: {
      type: 'array',
      description: 'Musical styles (e.g., orchestral, ambient, rock)',
      items: { type: 'string' },
      maxItems: 10,
    },
    instrument_tags: {
      type: 'array',
      description: 'Prominent instruments (e.g., strings, piano, drums)',
      items: { type: 'string' },
      maxItems: 10,
    },
  },
  required: ['recipe_name', 'prompt', 'bpm', 'mood_tags', 'style_tags', 'instrument_tags'],
} as const;

/**
 * Build system prompt for recipe design
 */
function buildSystemPrompt(): string {
  return `You are an expert music supervisor for tabletop RPG sessions.
Given a scene description, design a music track recipe that fits the mood and atmosphere.

DESIGN PRINCIPLES:
1. Create evocative prompts that capture the scene's emotional core
2. Match BPM to scene energy (60-80 calm, 90-120 moderate, 130-180 intense)
3. Use specific, descriptive mood tags that convey atmosphere
4. Choose musical styles that enhance the scene without overshadowing play
5. Suggest 3-6 prominent instruments that define the track's character
6. Keep prompts under 200 characters while being vivid and specific

BPM GUIDELINES:
- 60-80: Ambient, contemplative, slow exploration
- 90-100: Casual conversation, town scenes, light investigation
- 110-120: Travel, moderate tension, dungeon exploration
- 130-140: Chase scenes, combat preparation, rising action
- 150-180: Intense combat, climactic moments, high energy

MOOD TAG EXAMPLES:
- Emotional: epic, tense, mysterious, melancholic, triumphant, ominous, peaceful
- Atmospheric: dark, bright, ethereal, gritty, majestic, haunting, whimsical

STYLE TAG EXAMPLES:
- orchestral, ambient, cinematic, folk, electronic, rock, celtic, medieval, jazz

INSTRUMENT TAG EXAMPLES:
- strings, piano, drums, brass, woodwinds, choir, guitar, synth, percussion

Output only valid JSON matching the exact schema.`;
}

/**
 * Verify campaign ownership
 */
async function verifyCampaignOwnership(
  db: ExtendedDatabase,
  userId: string,
  campaignId: string
): Promise<void> {
  const campaign = await db.oneOrNone(
    'SELECT id FROM campaigns WHERE id = $1 AND user_id = $2',
    [campaignId, userId]
  );

  if (!campaign) {
    throw new NotFoundError('Campaign');
  }
}

/**
 * Verify session ownership (through campaign)
 */
async function verifySessionOwnership(
  db: ExtendedDatabase,
  userId: string,
  sessionId: string
): Promise<string> {
  const session = await db.oneOrNone(
    `SELECT s.id, s.campaign_id, c.user_id
     FROM sessions s
     JOIN campaigns c ON c.id = s.campaign_id
     WHERE s.id = $1`,
    [sessionId]
  );

  if (!session) {
    throw new NotFoundError('Session');
  }

  if (session.user_id !== userId) {
    throw new NotFoundError('Session');
  }

  return session.campaign_id;
}

/**
 * Validate recipe data
 */
function validateRecipeData(data: CreateTrackRecipeData): void {
  if (!data.recipe_name || data.recipe_name.trim().length === 0) {
    throw new ValidationError('Recipe name is required');
  }
  if (data.recipe_name.trim().length > 255) {
    throw new ValidationError('Recipe name must not exceed 255 characters');
  }

  if (!data.prompt || data.prompt.trim().length === 0) {
    throw new ValidationError('Prompt is required');
  }
  if (data.prompt.trim().length > 200) {
    throw new ValidationError('Prompt must not exceed 200 characters (Suno API limit)');
  }

  if (data.bpm !== undefined) {
    if (!Number.isInteger(data.bpm) || data.bpm < 60 || data.bpm > 180) {
      throw new ValidationError('BPM must be an integer between 60 and 180');
    }
  }

  // Validate tag arrays
  const tagFields: Array<{ name: string; value?: string[] }> = [
    { name: 'mood_tags', value: data.mood_tags },
    { name: 'style_tags', value: data.style_tags },
    { name: 'instrument_tags', value: data.instrument_tags },
  ];

  for (const field of tagFields) {
    if (field.value !== undefined) {
      if (!Array.isArray(field.value)) {
        throw new ValidationError(`${field.name} must be an array`);
      }
      if (field.value.length > 10) {
        throw new ValidationError(`${field.name} cannot have more than 10 items`);
      }
      for (const tag of field.value) {
        if (typeof tag !== 'string' || tag.trim().length === 0 || tag.trim().length > 50) {
          throw new ValidationError(`Each ${field.name} item must be between 1 and 50 characters`);
        }
      }
    }
  }
}

/**
 * Design a track recipe using LLM
 * Uses GPT-4-turbo (or configured model) with Structured Outputs
 * Target latency: < 3 seconds
 * Target cost: < $0.01 per recipe
 */
export async function designRecipe(
  db: ExtendedDatabase,
  userId: string,
  campaignId: string | undefined,
  sessionId: string | undefined,
  request: DesignRecipeRequest
): Promise<TrackRecipe> {
  const startTime = Date.now();

  // Verify ownership
  if (campaignId) {
    await verifyCampaignOwnership(db, userId, campaignId);
  } else if (sessionId) {
    campaignId = await verifySessionOwnership(db, userId, sessionId);
  } else {
    throw new ValidationError('Either campaign_id or session_id is required');
  }

  // Validate input


  // Sanitize input (prevent prompt injection)
  const sanitizedDescription = request.existing_tags ? request.existing_tags.join(', ') : ''
    .trim()
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ''); // Remove control characters

  logger.info('Designing track recipe with LLM', {
    user_id: userId,
    campaign_id: campaignId,
    session_id: sessionId,
    description_length: sanitizedDescription.length,
  });

  try {
    // Build user message with context
    let userMessage = `Design a music track recipe for: ${sanitizedDescription}`;

    // Call LLM with Structured Outputs (uses OpenAI by default for strict JSON schema support)
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: buildSystemPrompt(),
      },
      {
        role: 'user',
        content: userMessage,
      },
    ];

    const completion = await llmService.complete(
      messages,
      llmService.getModel('musicRecipe'),
      {
        temperature: 0.8, // Higher creativity for music design
        maxTokens: 1000,
        responseSchema: {
          name: 'track_recipe_design',
          strict: true,
          schema: recipeDesignSchema,
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

    // Create recipe in database
    const recipeData: CreateTrackRecipeData = {
      recipe_name: designData.recipe_name,
      prompt: designData.prompt,
      bpm: designData.bpm,
      mood_tags: designData.mood_tags,
      style_tags: designData.style_tags,
      instrument_tags: designData.instrument_tags,
      campaign_id: campaignId,
      session_id: sessionId,
    };

    const recipe = await createRecipe(db, userId, recipeData);

    // Log success metrics
    logger.info('Track recipe designed successfully', {
      user_id: userId,
      campaign_id: campaignId,
      session_id: sessionId,
      recipe_id: recipe.id,
      recipe_name: recipe.recipe_name,
      bpm: recipe.bpm,
      latency_ms: latency,
      tokens_used: completion.promptTokens + completion.completionTokens,
      prompt_tokens: completion.promptTokens,
      completion_tokens: completion.completionTokens,
      model: completion.model,
    });

    // Performance warning if > 3s
    if (latency > 3000) {
      logger.warn('Recipe design exceeded 3s performance target', {
        latency_ms: latency,
      });
    }

    return recipe;
  } catch (error: any) {
    const latency = Date.now() - startTime;

    logger.error('Recipe design failed', {
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
        throw new ValidationError('Invalid request to AI service. Please simplify your description.');
      } else if (status === 500 || status === 503) {
        throw new ValidationError('AI service temporarily unavailable. Please try again.');
      }
    }

    // Re-throw as validation error
    throw new ValidationError(
      `Failed to design recipe: ${error.message || 'Unknown error'}`
    );
  }
}

/**
 * Create a track recipe manually
 * Validates and stores recipe data
 */
export async function createRecipe(
  db: ExtendedDatabase,
  userId: string,
  data: CreateTrackRecipeData
): Promise<TrackRecipe> {
  // Verify ownership
  if (data.campaign_id) {
    await verifyCampaignOwnership(db, userId, data.campaign_id);
  } else if (data.session_id) {
    await verifySessionOwnership(db, userId, data.session_id);
  }

  // Validate recipe data
  validateRecipeData(data);

  // Normalize tags (trim and lowercase)
  const normalizedMoodTags = data.mood_tags?.map(tag => tag.trim().toLowerCase()) || [];
  const normalizedStyleTags = data.style_tags?.map(tag => tag.trim().toLowerCase()) || [];
  const normalizedInstrumentTags = data.instrument_tags?.map(tag => tag.trim().toLowerCase()) || [];

  const recipe = await db.one<TrackRecipe>(
    `INSERT INTO track_recipes (
      campaign_id, session_id, recipe_name, prompt, bpm,
      mood_tags, style_tags, instrument_tags
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *`,
    [
      data.campaign_id || null,
      data.session_id || null,
      data.recipe_name.trim(),
      data.prompt.trim(),
      data.bpm || null,
      normalizedMoodTags.length > 0 ? normalizedMoodTags : null,
      normalizedStyleTags.length > 0 ? normalizedStyleTags : null,
      normalizedInstrumentTags.length > 0 ? normalizedInstrumentTags : null,
    ]
  );

  logger.info('Track recipe created', {
    recipe_id: recipe.id,
    campaign_id: data.campaign_id,
    session_id: data.session_id,
    user_id: userId,
    recipe_name: recipe.recipe_name,
    bpm: recipe.bpm,
  });

  return recipe;
}

/**
 * Get recipe by ID
 * Verifies ownership via campaign/session
 */
export async function getRecipe(
  db: ExtendedDatabase,
  userId: string,
  recipeId: string
): Promise<TrackRecipe> {
  // Get recipe
  const recipe = await db.oneOrNone<TrackRecipe>(
    'SELECT * FROM track_recipes WHERE id = $1',
    [recipeId]
  );

  if (!recipe) {
    throw new NotFoundError('Track recipe');
  }

  // Verify ownership through campaign or session
  if (recipe.campaign_id) {
    await verifyCampaignOwnership(db, userId, recipe.campaign_id);
  } else if (recipe.session_id) {
    await verifySessionOwnership(db, userId, recipe.session_id);
  }

  logger.debug('Track recipe retrieved', {
    recipe_id: recipeId,
    campaign_id: recipe.campaign_id,
    session_id: recipe.session_id,
    user_id: userId,
  });

  return recipe;
}

/**
 * List recipes for a campaign
 * Returns all recipes ordered by creation date (newest first)
 */
export async function listRecipesForCampaign(
  db: ExtendedDatabase,
  userId: string,
  campaignId: string
): Promise<TrackRecipe[]> {
  // Verify campaign ownership
  await verifyCampaignOwnership(db, userId, campaignId);

  const recipes = await db.any<TrackRecipe>(
    `SELECT * FROM track_recipes
     WHERE campaign_id = $1
     ORDER BY created_at DESC`,
    [campaignId]
  );

  logger.debug('Track recipes listed for campaign', {
    campaign_id: campaignId,
    user_id: userId,
    count: recipes.length,
  });

  return recipes;
}

/**
 * List recipes for a session
 * Returns all recipes ordered by creation date (newest first)
 */
export async function listRecipesForSession(
  db: ExtendedDatabase,
  userId: string,
  sessionId: string
): Promise<TrackRecipe[]> {
  // Verify session ownership
  await verifySessionOwnership(db, userId, sessionId);

  const recipes = await db.any<TrackRecipe>(
    `SELECT * FROM track_recipes
     WHERE session_id = $1
     ORDER BY created_at DESC`,
    [sessionId]
  );

  logger.debug('Track recipes listed for session', {
    session_id: sessionId,
    user_id: userId,
    count: recipes.length,
  });

  return recipes;
}

/**
 * Delete recipe
 * Verifies ownership and cascade deletes all related tracks
 */
export async function deleteRecipe(
  db: ExtendedDatabase,
  userId: string,
  recipeId: string
): Promise<void> {
  // Get recipe and verify ownership
  await getRecipe(db, userId, recipeId);

  const result = await db.result(
    'DELETE FROM track_recipes WHERE id = $1',
    [recipeId]
  );

  if (result.rowCount === 0) {
    throw new NotFoundError('Track recipe');
  }

  logger.info('Track recipe deleted', {
    recipe_id: recipeId,
    user_id: userId,
  });
}
