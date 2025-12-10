/**
 * LLM Service - Unified interface for multiple LLM providers
 * Supports OpenAI and Google Gemini with consistent API
 */

import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { llmConfig, LLMProvider } from '../config/llm';
import logger from '../utils/logger';

// ============================================================
// Types
// ============================================================

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompletionOptions {
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  responseSchema?: any; // For OpenAI Structured Outputs
}

export interface CompletionResponse {
  content: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
}

export interface StreamChunk {
  content: string;
}

// ============================================================
// OpenAI Provider
// ============================================================

class OpenAIProvider {
  private client: OpenAI;

  constructor() {
    const config: any = {
      apiKey: llmConfig.openai.apiKey,
    };

    if (llmConfig.openai.orgId && llmConfig.openai.orgId.trim() !== '') {
      config.organization = llmConfig.openai.orgId;
    }

    this.client = new OpenAI(config);
  }

  async complete(
    messages: ChatMessage[],
    model: string,
    options: CompletionOptions = {}
  ): Promise<CompletionResponse> {
    const startTime = Date.now();

    const requestParams: any = {
      model,
      messages: messages as OpenAI.Chat.ChatCompletionMessageParam[],
      temperature: options.temperature ?? 0.3,
      max_tokens: options.maxTokens ?? 1000,
      service_tier: llmConfig.openai.serviceTier,
    };

    // Handle JSON mode or Structured Outputs
    if (options.jsonMode) {
      requestParams.response_format = { type: 'json_object' };
    }

    if (options.responseSchema) {
      requestParams.response_format = {
        type: 'json_schema',
        json_schema: options.responseSchema,
      };
    }

    const response = await this.client.chat.completions.create(requestParams);

    const latencyMs = Date.now() - startTime;

    return {
      content: response.choices[0].message.content || '',
      model: response.model,
      promptTokens: response.usage?.prompt_tokens || 0,
      completionTokens: response.usage?.completion_tokens || 0,
      latencyMs,
    };
  }

  async *streamComplete(
    messages: ChatMessage[],
    model: string,
    options: CompletionOptions = {}
  ): AsyncGenerator<StreamChunk | CompletionResponse, void, unknown> {
    const startTime = Date.now();

    const stream = await this.client.chat.completions.create({
      model,
      messages: messages as OpenAI.Chat.ChatCompletionMessageParam[],
      temperature: options.temperature ?? 0.3,
      max_tokens: options.maxTokens ?? 1000,
      service_tier: llmConfig.openai.serviceTier as any,
      stream: true,
    });

    let fullAnswer = '';
    let promptTokens = 0;
    let completionTokens = 0;

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content || '';

      if (delta) {
        fullAnswer += delta;
        completionTokens++; // Rough estimate

        yield {
          content: delta,
        };
      }

      // Extract usage from final chunk
      if (chunk.usage) {
        promptTokens = chunk.usage.prompt_tokens || 0;
        completionTokens = chunk.usage.completion_tokens || 0;
      }
    }

    const latencyMs = Date.now() - startTime;

    // Yield final metadata
    yield {
      content: fullAnswer,
      model,
      promptTokens,
      completionTokens,
      latencyMs,
    };
  }
}

// ============================================================
// Gemini Provider
// ============================================================

class GeminiProvider {
  private client: GoogleGenerativeAI;

  constructor() {
    this.client = new GoogleGenerativeAI(llmConfig.gemini.apiKey);
  }

  async complete(
    messages: ChatMessage[],
    model: string,
    options: CompletionOptions = {}
  ): Promise<CompletionResponse> {
    const startTime = Date.now();

    const geminiModel = this.client.getGenerativeModel({ model });

    // Convert messages to Gemini format
    const { systemInstruction, contents } = this.convertMessagesToGemini(messages);

    // Configure generation
    const generationConfig: any = {
      temperature: options.temperature ?? 0.3,
      maxOutputTokens: options.maxTokens ?? 1000,
    };

    if (options.jsonMode || options.responseSchema) {
      generationConfig.responseMimeType = 'application/json';
    }

    const result = await geminiModel.generateContent({
      contents,
      systemInstruction,
      generationConfig,
    });

    const response = result.response;
    const latencyMs = Date.now() - startTime;

    return {
      content: response.text(),
      model,
      promptTokens: response.usageMetadata?.promptTokenCount || 0,
      completionTokens: response.usageMetadata?.candidatesTokenCount || 0,
      latencyMs,
    };
  }

  async *streamComplete(
    messages: ChatMessage[],
    model: string,
    options: CompletionOptions = {}
  ): AsyncGenerator<StreamChunk | CompletionResponse, void, unknown> {
    const startTime = Date.now();

    const geminiModel = this.client.getGenerativeModel({ model });

    // Convert messages to Gemini format
    const { systemInstruction, contents } = this.convertMessagesToGemini(messages);

    // Configure generation
    const generationConfig: any = {
      temperature: options.temperature ?? 0.3,
      maxOutputTokens: options.maxTokens ?? 1000,
    };

    if (options.jsonMode || options.responseSchema) {
      generationConfig.responseMimeType = 'application/json';
    }

    const result = await geminiModel.generateContentStream({
      contents,
      systemInstruction,
      generationConfig,
    });

    let fullAnswer = '';
    let promptTokens = 0;
    let completionTokens = 0;

    for await (const chunk of result.stream) {
      const delta = chunk.text();

      if (delta) {
        fullAnswer += delta;

        yield {
          content: delta,
        };
      }
    }

    // Get final metadata
    const response = await result.response;
    promptTokens = response.usageMetadata?.promptTokenCount || 0;
    completionTokens = response.usageMetadata?.candidatesTokenCount || 0;

    const latencyMs = Date.now() - startTime;

    // Yield final metadata
    yield {
      content: fullAnswer,
      model,
      promptTokens,
      completionTokens,
      latencyMs,
    };
  }

  private convertMessagesToGemini(messages: ChatMessage[]): {
    systemInstruction?: string;
    contents: any[];
  } {
    let systemInstruction: string | undefined;
    const contents: any[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        // Gemini uses separate systemInstruction field
        systemInstruction = msg.content;
      } else {
        contents.push({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: msg.content }],
        });
      }
    }

    return { systemInstruction, contents };
  }
}

// ============================================================
// Main LLM Service
// ============================================================

export class LLMService {
  private openaiProvider: OpenAIProvider;
  private geminiProvider: GeminiProvider;

  constructor() {
    this.openaiProvider = new OpenAIProvider();
    this.geminiProvider = new GeminiProvider();
  }

  /**
   * Get completion from specified provider
   */
  async complete(
    messages: ChatMessage[],
    model: string,
    options: CompletionOptions = {},
    provider: LLMProvider = llmConfig.defaultProvider
  ): Promise<CompletionResponse> {
    logger.debug('LLM completion request', {
      provider,
      model,
      messageCount: messages.length,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
    });

    try {
      const result =
        provider === 'openai'
          ? await this.openaiProvider.complete(messages, model, options)
          : await this.geminiProvider.complete(messages, model, options);

      logger.info('LLM completion successful', {
        provider,
        model: result.model,
        latencyMs: result.latencyMs,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
      });

      return result;
    } catch (error: any) {
      logger.error('LLM completion failed', {
        provider,
        model,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get streaming completion from specified provider
   */
  async *streamComplete(
    messages: ChatMessage[],
    model: string,
    options: CompletionOptions = {},
    provider: LLMProvider = llmConfig.defaultProvider
  ): AsyncGenerator<StreamChunk | CompletionResponse, void, unknown> {
    logger.debug('LLM streaming request', {
      provider,
      model,
      messageCount: messages.length,
    });

    try {
      const stream =
        provider === 'openai'
          ? this.openaiProvider.streamComplete(messages, model, options)
          : this.geminiProvider.streamComplete(messages, model, options);

      for await (const chunk of stream) {
        yield chunk;
      }
    } catch (error: any) {
      logger.error('LLM streaming failed', {
        provider,
        model,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get model name for specific use case and provider
   */
  getModel(
    useCase: 'ragQA' | 'generatorDesign' | 'musicRecipe',
    provider: LLMProvider = llmConfig.defaultProvider
  ): string {
    if (provider === 'openai') {
      return llmConfig.openai.models[useCase];
    } else {
      return llmConfig.gemini.models[useCase];
    }
  }
}

// Export singleton instance
export const llmService = new LLMService();
