/**
 * LLM Provider Configuration
 * Supports multiple vendors: OpenAI, Google Gemini, etc.
 */

export type LLMProvider = 'openai' | 'gemini';

export interface LLMConfig {
  // Default provider for all operations
  defaultProvider: LLMProvider;

  // Provider-specific configurations
  openai: {
    apiKey: string;
    orgId?: string;
    serviceTier: 'auto' | 'default' | 'priority' | 'flex' | 'scale';
    models: {
      ragQA: string;
      generatorDesign: string;
      musicRecipe: string;
      embedding: string;
    };
  };

  gemini: {
    apiKey: string;
    models: {
      ragQA: string;
      generatorDesign: string;
      musicRecipe: string;
    };
  };
}

/**
 * Load LLM configuration from environment variables
 */
export function loadLLMConfig(): LLMConfig {
  return {
    defaultProvider: (process.env.LLM_PROVIDER || 'openai') as LLMProvider,

    openai: {
      apiKey: process.env.OPENAI_API_KEY || '',
      orgId: process.env.OPENAI_ORG_ID || '',
      serviceTier: (process.env.OPENAI_SERVICE_TIER || 'default') as any,
      models: {
        ragQA: process.env.OPENAI_MODEL_RAG || 'gpt-4o-mini',
        generatorDesign: process.env.OPENAI_MODEL_GENERATOR || 'gpt-4o-mini',
        musicRecipe: process.env.OPENAI_MODEL_MUSIC || 'gpt-4o-mini',
        embedding: process.env.OPENAI_MODEL_EMBEDDING || 'text-embedding-3-small',
      },
    },

    gemini: {
      apiKey: process.env.GEMINI_API_KEY || '',
      models: {
        ragQA: process.env.GEMINI_MODEL_RAG || 'gemini-1.5-flash',
        generatorDesign: process.env.GEMINI_MODEL_GENERATOR || 'gemini-1.5-flash',
        musicRecipe: process.env.GEMINI_MODEL_MUSIC || 'gemini-1.5-flash',
      },
    },
  };
}

/**
 * Validate LLM configuration
 */
export function validateLLMConfig(config: LLMConfig): void {
  const provider = config.defaultProvider;

  if (provider === 'openai' && !config.openai.apiKey) {
    console.warn('WARNING: OPENAI_API_KEY not set. OpenAI LLM features will not work.');
  }

  if (provider === 'gemini' && !config.gemini.apiKey) {
    console.warn('WARNING: GEMINI_API_KEY not set. Gemini LLM features will not work.');
  }

  // Warn if default provider has no API key
  if (provider === 'openai' && !config.openai.apiKey) {
    throw new Error('Default LLM provider is OpenAI but OPENAI_API_KEY is not set');
  }

  if (provider === 'gemini' && !config.gemini.apiKey) {
    throw new Error('Default LLM provider is Gemini but GEMINI_API_KEY is not set');
  }
}

export const llmConfig = loadLLMConfig();
