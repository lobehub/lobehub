import { TRPCError } from '@trpc/server';

export interface SunoGenerateRequest {
  prompt: string;
  style?: string;
  duration?: number;
  model?: string;
  make_instrumental?: boolean;
  wait_audio?: boolean;
}

export interface SunoTask {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  audio_url?: string;
  title?: string;
  image_large_url?: string;
  image_url?: string;
  lyric_url?: string;
  duration?: number;
  error?: string;
}

export class SunoAPIClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey?: string, baseUrl?: string) {
    this.apiKey = apiKey || process.env.KIE_API_KEY || '';
    this.baseUrl = baseUrl || process.env.SUNO_API_BASE_URL || 'https://api.kie.ai/v1';

    if (!this.apiKey) {
      throw new Error('KIE_API_KEY environment variable is not set');
    }
  }

  /**
   * Generate music from prompt using Suno API
   * @returns Task ID for polling
   */
  async generateMusic(request: SunoGenerateRequest): Promise<string> {
    const payload = {
      ...request,
      model: request.model || 'v5.5',
      make_instrumental: request.make_instrumental ?? false,
      wait_audio: request.wait_audio ?? false,
    };

    try {
      const response = await fetch(`${this.baseUrl}/generate`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.error?.message || errorData.message || 'Unknown error';
        throw new Error(`Suno API error: ${response.status} - ${errorMessage}`);
      }

      const data = await response.json();

      if (!data.id) {
        throw new Error('No task ID returned from Suno API');
      }

      return data.id;
    } catch (error) {
      if (error instanceof Error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to generate music: ${error.message}`,
        });
      }
      throw error;
    }
  }

  /**
   * Poll task status from Suno API
   */
  async getTaskStatus(taskId: string): Promise<SunoTask> {
    try {
      const response = await fetch(`${this.baseUrl}/task/${taskId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.error?.message || errorData.message || 'Unknown error';
        throw new Error(`Suno API error: ${response.status} - ${errorMessage}`);
      }

      const data = await response.json();

      // Map API response to SunoTask format
      return {
        id: data.id,
        status: this.mapStatus(data.status),
        audio_url: data.audio_url,
        title: data.title,
        image_large_url: data.image_large_url,
        image_url: data.image_url,
        lyric_url: data.lyric_url,
        duration: data.duration,
        error: data.error,
      };
    } catch (error) {
      if (error instanceof Error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to get task status: ${error.message}`,
        });
      }
      throw error;
    }
  }

  /**
   * Map Suno API status to normalized status
   */
  private mapStatus(apiStatus: string): SunoTask['status'] {
    const statusMap: Record<string, SunoTask['status']> = {
      'pending': 'pending',
      'processing': 'processing',
      'completed': 'completed',
      'success': 'completed',
      'failed': 'failed',
      'error': 'failed',
    };

    return statusMap[apiStatus.toLowerCase()] || 'processing';
  }
}

export const sunoClient = new SunoAPIClient();
