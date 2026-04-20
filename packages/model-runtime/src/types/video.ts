import type { RuntimeVideoGenParams } from 'model-bank';

export type CreateVideoErrorPayload = {
  error: any;
  errorType: string;
  provider?: string;
};

export type CreateVideoPayload = {
  callbackUrl?: string;
  model: string;
  params: RuntimeVideoGenParams;
};

export type CreateVideoResponse =
  | {
      inferenceId: string;
      /** Provider uses webhook callback instead of polling */
      useWebhook?: boolean;
    }
  | {
      inferenceId: string;
      videoUrl: string;
    };

export type PollVideoStatusResult =
  | {
      headers?: Record<string, string>;
      status: 'success';
      videoUrl: string;
    }
  | {
      error: string;
      status: 'failed';
    }
  | {
      status: 'pending';
    };

export type HandleCreateVideoWebhookPayload = {
  body: unknown;
  headers?: Record<string, string>;
};

export type HandleCreateVideoWebhookResult =
  | { status: 'pending' }
  | {
      generateAudio?: boolean;
      inferenceId: string;
      model?: string;
      status: 'success';
      usage?: { completionTokens: number; totalTokens: number };
      videoUrl: string;
    }
  | { error: string; inferenceId: string; status: 'error' };
