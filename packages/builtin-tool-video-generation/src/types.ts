import type { AsyncTaskError, AsyncTaskStatus, Generation } from '@lobechat/types';
import type { Pricing, RuntimeVideoGenParams, VideoModelParamsSchema } from 'model-bank';

export const VideoGenerationIdentifier = 'lobe-video-generation';

export const VideoGenerationApiName = {
  generateVideo: 'generateVideo',
  getVideoGenerationStatus: 'getVideoGenerationStatus',
  getVideoModelParameters: 'getVideoModelParameters',
  listVideoModels: 'listVideoModels',
} as const;

export type VideoGenerationApiName =
  (typeof VideoGenerationApiName)[keyof typeof VideoGenerationApiName];

export interface VideoGenerationModelSummary {
  approximatePricePerVideo?: number;
  description?: string;
  displayName?: string;
  id: string;
  parameters?: VideoModelParamsSchema;
  pricePerVideo?: number;
  pricing?: Pricing;
  releasedAt?: string;
}

export interface VideoGenerationProviderModels {
  id: string;
  models: VideoGenerationModelSummary[];
  name?: string;
}

export interface ListVideoModelsParams {
  /**
   * Maximum models to return per provider.
   */
  limit?: number;
  /**
   * Provider id, for example `lobehub`, `volcengine`, or `google`.
   */
  provider?: string;
}

export interface ListVideoModelsState {
  providers: VideoGenerationProviderModels[];
  totalModels: number;
}

export interface GetVideoModelParametersParams {
  model: string;
  provider: string;
}

export interface GetVideoModelParametersState {
  defaultValues?: RuntimeVideoGenParams;
  displayName?: string;
  model: string;
  parameters?: VideoModelParamsSchema;
  provider: string;
}

export interface GenerateVideoParams {
  /**
   * Optional final-frame image URL. Use only URLs already accessible to LobeHub.
   */
  endImageUrl?: null | string;
  /**
   * Optional first-frame or reference image URL. Use only URLs already accessible to LobeHub.
   */
  imageUrl?: null | string;
  /**
   * Optional reference image URLs for models that support multiple references.
   */
  imageUrls?: string[];
  model?: string;
  parameters?: Partial<RuntimeVideoGenParams> & Record<string, unknown>;
  prompt: string;
  provider?: string;
  /**
   * Maximum time to wait for the final video URL when waitUntilComplete is enabled.
   */
  waitTimeoutMs?: number;
  /**
   * Wait for the generated video URL before returning. Defaults to true.
   */
  waitUntilComplete?: boolean;
}

export interface GeneratedVideoTask {
  asset?: Generation['asset'] | null;
  asyncTaskId: string;
  error?: AsyncTaskError | null;
  generationId: string;
  status?: AsyncTaskStatus;
}

export interface GenerateVideoState {
  batchId?: string;
  generation: GeneratedVideoTask;
  generationTopicId: string;
  model: string;
  prompt: string;
  provider: string;
  waitError?: string;
  waitTimedOut?: boolean;
  waitUntilComplete?: boolean;
}

export interface GetVideoGenerationStatusParams {
  asyncTaskId: string;
  generationId: string;
}

export interface GetVideoGenerationStatusState {
  asyncTaskId: string;
  error: AsyncTaskError | null;
  generation: Generation | null;
  generationId: string;
  status: AsyncTaskStatus;
}

export interface VideoGenerationCreateVideoPayload {
  generationTopicId: string;
  model: string;
  params: RuntimeVideoGenParams & Record<string, unknown>;
  provider: string;
}

export interface VideoGenerationCreateVideoResult {
  data?: {
    batch?: { id?: string };
    generations?: Array<{
      asyncTaskId?: null | string;
      id?: string;
    }>;
  };
  success?: boolean;
}
