/**
 * Suno API client
 * Handles music generation via Suno API with test mode support
 *
 * CRITICAL: Limited API credits - always use test mode during development!
 */

import axios, { AxiosInstance } from 'axios';
import config from '../config';
import logger from '../utils/logger';
import { ValidationError } from '../types';

// API response types
export interface GenerateTrackResponse {
  sunoTrackId: string;
  status: 'pending' | 'generating' | 'completed' | 'failed';
}

export interface TrackStatusResponse {
  status: 'generating' | 'completed' | 'failed';
  audioUrl?: string;
  duration?: number;
  error?: string;
}

export interface GenerateTrackOptions {
  bpm?: number;
  duration?: number;
  tags?: string[];
  testMode?: boolean;
}

// Axios instance for Suno API
let sunoClient: AxiosInstance | null = null;

/**
 * Initialize Suno API client
 */
function getSunoClient(): AxiosInstance {
  if (!sunoClient) {
    sunoClient = axios.create({
      baseURL: config.music.sunoBaseUrl,
      timeout: 30000, // 30 second timeout
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.music.sunoApiKey}`,
      },
    });

    // Add response interceptor for logging
    sunoClient.interceptors.response.use(
      (response) => {
        logger.debug('Suno API response', {
          status: response.status,
          url: response.config.url,
        });
        return response;
      },
      (error) => {
        logger.error('Suno API error', {
          status: error.response?.status,
          url: error.config?.url,
          error: error.message,
        });
        return Promise.reject(error);
      }
    );
  }

  return sunoClient;
}

/**
 * Generate mock track data for test mode
 */
function generateMockTrack(prompt: string, options?: GenerateTrackOptions): GenerateTrackResponse {
  const mockId = `mock-${Date.now()}-${Math.random().toString(36).substring(7)}`;

  logger.info('Mock track generation (test mode)', {
    mock_id: mockId,
    prompt_length: prompt.length,
    bpm: options?.bpm,
    tags: options?.tags,
  });

  return {
    sunoTrackId: mockId,
    status: 'completed',
  };
}

/**
 * Get mock track status for test mode
 */
function getMockTrackStatus(sunoTrackId: string): TrackStatusResponse {
  logger.debug('Mock track status check (test mode)', { mock_id: sunoTrackId });

  // Mock URLs point to public domain classical music samples
  const mockUrls = [
    'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
    'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3',
    'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3',
  ];

  const randomUrl = mockUrls[Math.floor(Math.random() * mockUrls.length)];

  return {
    status: 'completed',
    audioUrl: randomUrl,
    duration: 180 + Math.floor(Math.random() * 120), // 180-300 seconds
  };
}

/**
 * Generate a music track via Suno API
 *
 * @param prompt - Music generation prompt (max 200 characters)
 * @param options - Generation options including test mode flag
 * @returns Track ID and initial status
 *
 * TEST MODE: If testMode is true or API key is missing, returns mock data
 * without calling the actual Suno API (preserves credits)
 */
export async function generateTrack(
  prompt: string,
  options?: GenerateTrackOptions
): Promise<GenerateTrackResponse> {
  // Validate prompt
  if (!prompt || prompt.trim().length === 0) {
    throw new ValidationError('Prompt is required');
  }

  if (prompt.trim().length > 200) {
    throw new ValidationError('Prompt must not exceed 200 characters');
  }

  // TEST MODE: Return mock data if enabled or no API key
  if (options?.testMode || !config.music.sunoApiKey) {
    if (options?.testMode) {
      logger.warn('Test mode enabled - using mock track generation');
    } else {
      logger.warn('Suno API key not configured - using mock track generation');
    }
    return generateMockTrack(prompt, options);
  }

  const startTime = Date.now();

  try {
    const client = getSunoClient();

    // Build request payload
    const payload: any = {
      prompt: prompt.trim(),
      make_instrumental: false,
      wait_audio: false, // Don't wait for audio, we'll poll
    };

    if (options?.bpm) {
      payload.bpm = options.bpm;
    }

    if (options?.tags && options.tags.length > 0) {
      payload.tags = options.tags.join(', ');
    }

    if (options?.duration) {
      payload.duration = options.duration;
    }

    // Call Suno API
    const response = await client.post('/api/generate', payload);

    const latency = Date.now() - startTime;

    // Parse response (adjust based on actual Suno API response format)
    const trackId = response.data.id || response.data.track_id || response.data[0]?.id;

    if (!trackId) {
      throw new Error('No track ID in Suno API response');
    }

    logger.info('Track generation initiated', {
      suno_track_id: trackId,
      prompt_length: prompt.length,
      bpm: options?.bpm,
      latency_ms: latency,
    });

    return {
      sunoTrackId: trackId,
      status: 'generating',
    };
  } catch (error: any) {
    const latency = Date.now() - startTime;

    logger.error('Track generation failed', {
      error: error.message,
      status: error.response?.status,
      latency_ms: latency,
    });

    // Handle specific error cases
    if (error.response) {
      const status = error.response.status;
      if (status === 429) {
        throw new ValidationError('Rate limit exceeded. Please try again later.');
      } else if (status === 402) {
        throw new ValidationError('Insufficient credits. Please check your Suno account.');
      } else if (status === 400) {
        throw new ValidationError('Invalid generation request. Please check your prompt.');
      }
    }

    throw new Error(`Track generation failed: ${error.message}`);
  }
}

/**
 * Get track generation status
 *
 * @param sunoTrackId - Suno track ID from generateTrack
 * @param testMode - If true, returns mock status
 * @returns Track status with audio URL if completed
 *
 * TEST MODE: If testMode is true or track ID starts with "mock-", returns mock status
 */
export async function getTrackStatus(
  sunoTrackId: string,
  testMode?: boolean
): Promise<TrackStatusResponse> {
  // TEST MODE: Return mock status if enabled or mock ID
  if (testMode || sunoTrackId.startsWith('mock-') || !config.music.sunoApiKey) {
    return getMockTrackStatus(sunoTrackId);
  }

  try {
    const client = getSunoClient();

    // Call Suno API to get track status
    const response = await client.get(`/api/feed/${sunoTrackId}`);

    // Parse response (adjust based on actual Suno API response format)
    const trackData = Array.isArray(response.data) ? response.data[0] : response.data;

    const status = trackData.status;
    const audioUrl = trackData.audio_url || trackData.url;
    const duration = trackData.duration;

    // Map Suno status to our status values
    let mappedStatus: 'generating' | 'completed' | 'failed';
    if (status === 'complete' || status === 'completed') {
      mappedStatus = 'completed';
    } else if (status === 'error' || status === 'failed') {
      mappedStatus = 'failed';
    } else {
      mappedStatus = 'generating';
    }

    logger.debug('Track status checked', {
      suno_track_id: sunoTrackId,
      status: mappedStatus,
      has_audio_url: !!audioUrl,
    });

    return {
      status: mappedStatus,
      audioUrl: audioUrl || undefined,
      duration: duration || undefined,
      error: trackData.error_message || undefined,
    };
  } catch (error: any) {
    logger.error('Track status check failed', {
      suno_track_id: sunoTrackId,
      error: error.message,
      status: error.response?.status,
    });

    // If 404, track not found - treat as failed
    if (error.response?.status === 404) {
      return {
        status: 'failed',
        error: 'Track not found',
      };
    }

    throw new Error(`Track status check failed: ${error.message}`);
  }
}

/**
 * Get track download URL (once completed)
 *
 * @param sunoTrackId - Suno track ID
 * @param testMode - If true, returns mock URL
 * @returns Direct download URL for the audio file
 */
export async function getTrackDownloadUrl(
  sunoTrackId: string,
  testMode?: boolean
): Promise<string> {
  // Get current status (which includes audio URL)
  const status = await getTrackStatus(sunoTrackId, testMode);

  if (status.status !== 'completed') {
    throw new ValidationError('Track is not ready for download yet');
  }

  if (!status.audioUrl) {
    throw new Error('No audio URL available for completed track');
  }

  logger.info('Track download URL retrieved', {
    suno_track_id: sunoTrackId,
    url_length: status.audioUrl.length,
  });

  return status.audioUrl;
}

/**
 * Utility: Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
