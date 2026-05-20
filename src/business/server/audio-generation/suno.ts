import { TRPCError } from '@trpc/server';

export interface SunoGenerateRequest {
  /** Song description or lyrics (custom mode) */
  prompt: string;
  /** Music style tags (custom mode only, e.g. "pop rock energetic") */
  style?: string;
  /** Song title (custom mode only) */
  title?: string;
  /** Whether to use custom mode (user-provided lyrics + style) */
  customMode?: boolean;
  /** Whether to generate instrumental only (no vocals) */
  make_instrumental?: boolean;
  /** Model version — hardcoded to chirp-v3-5 (V5.5) */
  model?: string;
  /** Callback URL for async completion notification */
  callBackUrl?: string;
}

export interface SunoClip {
  id: string;
  status: 'pending' | 'streaming' | 'complete' | 'error' | 'processing';
  audio_url?: string;
  stream_audio_url?: string;
  title?: string;
  image_large_url?: string;
  image_url?: string;
  lyric?: string;
  duration?: number;
  error?: string;
  tags?: string;
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
  clips?: SunoClip[];
}

export class SunoAPIClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey?: string, baseUrl?: string) {
    this.apiKey = apiKey || process.env.KIE_API_KEY || '';
    this.baseUrl = baseUrl || process.env.KIE_API_BASE_URL || 'https://api.kie.ai';

    if (!this.apiKey) {
      throw new Error('KIE_API_KEY environment variable is not set');
    }
  }

  /**
   * Generate music using kie.ai/suno API (V5.5 model by default)
   * Supports custom mode (user-provided lyrics + style) and non-custom mode (AI-generated)
   * @returns Task ID for polling
   */
  async generateMusic(request: SunoGenerateRequest): Promise<string> {
    const isCustom = request.customMode ?? false;
    const endpoint = isCustom
      ? `${this.baseUrl}/api/suno/v1/music/generate`
      : `${this.baseUrl}/api/suno/v1/music/generate`;

    const payload: Record<string, unknown> = {
      model: 'chirp-v3-5',
      make_instrumental: request.make_instrumental ?? false,
      wait_audio: false,
    };

    if (isCustom) {
      // Custom mode: user provides lyrics and style
      payload.prompt = request.prompt;
      payload.tags = request.style || '';
      payload.title = request.title || 'My Song';
      payload.customMode = true;
    } else {
      // Non-custom mode: AI generates everything from description
      payload.prompt = request.prompt;
      payload.customMode = false;
    }

    if (request.callBackUrl) {
      payload.callBackUrl = request.callBackUrl;
    }

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage =
          errorData.error?.message ||
          errorData.message ||
          errorData.msg ||
          `HTTP ${response.status}`;
        throw new Error(`Music generation API error: ${errorMessage}`);
      }

      const data = await response.json();

      // kie.ai returns { code: 200, data: { taskId: "..." } }
      const taskId = data?.data?.taskId || data?.taskId || data?.id;
      if (!taskId) {
        throw new Error('No task ID returned from music generation API');
      }

      return taskId;
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
   * Poll task status from kie.ai API
   */
  async getTaskStatus(taskId: string): Promise<SunoTask> {
    try {
      const response = await fetch(
        `${this.baseUrl}/api/suno/v1/music/generate/${taskId}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
        },
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage =
          errorData.error?.message || errorData.message || `HTTP ${response.status}`;
        throw new Error(`Task status API error: ${errorMessage}`);
      }

      const data = await response.json();

      // kie.ai returns { code: 200, data: { clips: [...] } }
      const taskData = data?.data || data;
      const clips: SunoClip[] = taskData?.clips || taskData?.data || [];

      // Determine overall status from clips
      let overallStatus: SunoTask['status'] = 'pending';
      let firstClip: SunoClip | undefined;

      if (clips.length > 0) {
        firstClip = clips[0];
        const allComplete = clips.every(
          (c) => c.status === 'complete' || c.status === 'error',
        );
        const anyError = clips.every((c) => c.status === 'error');
        const anyStreaming = clips.some((c) => c.status === 'streaming');

        if (anyError && clips.every((c) => c.status === 'error')) {
          overallStatus = 'failed';
        } else if (allComplete) {
          overallStatus = 'completed';
        } else if (anyStreaming) {
          overallStatus = 'processing';
        } else {
          overallStatus = 'processing';
        }
      } else if (taskData?.state === 'success') {
        overallStatus = 'completed';
      } else if (taskData?.state === 'failed' || taskData?.state === 'error') {
        overallStatus = 'failed';
      }

      return {
        id: taskId,
        status: overallStatus,
        audio_url: firstClip?.audio_url || firstClip?.stream_audio_url,
        title: firstClip?.title,
        image_large_url: firstClip?.image_large_url,
        image_url: firstClip?.image_url,
        duration: firstClip?.duration,
        error: firstClip?.error,
        clips: clips.map((c) => ({
          ...c,
          status: this.normalizeClipStatus(c.status),
        })),
      };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      if (error instanceof Error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to get task status: ${error.message}`,
        });
      }
      throw error;
    }
  }

  private normalizeClipStatus(
    status: string,
  ): SunoClip['status'] {
    const map: Record<string, SunoClip['status']> = {
      pending: 'pending',
      queued: 'pending',
      streaming: 'streaming',
      processing: 'processing',
      complete: 'complete',
      completed: 'complete',
      success: 'complete',
      error: 'error',
      failed: 'error',
    };
    return map[status?.toLowerCase()] ?? 'pending';
  }
}

export const sunoClient = new SunoAPIClient();
