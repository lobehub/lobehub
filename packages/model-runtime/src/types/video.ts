import type {
  ModelTokensUsage,
  VideoGenerationCompletionMode,
  VideoGenerationRoute,
} from '@lobechat/types';
import type { RuntimeVideoGenParams } from 'model-bank';

import type { ModelPricingContext } from './pricing';

export type CreateVideoErrorPayload = {
  error: any;
  errorType: string;
  provider?: string;
};

export type CreateVideoPayload = {
  callbackUrl?: string;
  model: string;
  params: RuntimeVideoGenParams;
  previousInteractionId?: string;
};

export interface CreateVideoMethodOptions {
  /** Metadata passed to hooks (billing, tracing, etc.) */
  metadata?: Record<string, unknown>;
  /** Deployment preference; the selected runtime resolves it against model capabilities. */
  preferredCompletionMode?: VideoGenerationCompletionMode;
  /** Request-scoped pricing context for model-bank pricing lookups. */
  pricingContext?: ModelPricingContext;
  /**
   * Route that created the source video of a continuation. Stateful providers such as
   * Gemini Omni scope interactions to the creating API key, so the edit must reuse it.
   */
  route?: VideoPollingRoute;
}

export interface CreateVideoResult {
  inferenceId: string;
  videoUrl?: string;
}

export interface CreateVideoResponse extends CreateVideoResult {
  completionMode: VideoGenerationCompletionMode;
}

export interface VideoGenerationCapabilities {
  completionModes: readonly VideoGenerationCompletionMode[];
}

export interface VideoGenerationUsage {
  completionTokens: number;
  /**
   * Per-modality token breakdown for models billed by input and output modality (e.g. Gemini
   * Omni). When present, billing prices it with the model's token units instead of pricing
   * `completionTokens` at a single video rate.
   */
  modelUsage?: ModelTokensUsage;
  totalTokens: number;
}

export type PollVideoStatusResult =
  | {
      headers?: Record<string, string>;
      status: 'success';
      usage?: VideoGenerationUsage;
      videoUrl: string;
    }
  | {
      error: string;
      status: 'failed';
    }
  | {
      status: 'pending';
    };

export type VideoPollingRoute = VideoGenerationRoute;

export type HandleCreateVideoWebhookPayload = {
  body: unknown;
  headers?: Record<string, string>;
  model?: string;
  rawBody?: string;
  url?: string;
};

export type HandleCreateVideoWebhookResult =
  | { inferenceId?: string; status: 'pending' }
  | { inferenceId: string; status: 'completed' }
  | {
      generateAudio?: boolean;
      headers?: Record<string, string>;
      inferenceId: string;
      model?: string;
      status: 'success';
      usage?: VideoGenerationUsage;
      videoUrl: string;
    }
  | { error: string; inferenceId: string; status: 'error' };
