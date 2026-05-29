import type { AsyncTaskError, AsyncTaskStatus, Generation } from '@lobechat/types';
import type { ModelParamsSchema, Pricing, RuntimeImageGenParams } from 'model-bank';

export const ImageGenerationIdentifier = 'lobe-image-generation';

export const ImageGenerationApiName = {
  generateImage: 'generateImage',
  getImageGenerationStatus: 'getImageGenerationStatus',
  getImageModelParameters: 'getImageModelParameters',
  listImageModels: 'listImageModels',
} as const;

export type ImageGenerationApiName =
  (typeof ImageGenerationApiName)[keyof typeof ImageGenerationApiName];

export interface ImageGenerationModelSummary {
  approximatePricePerImage?: number;
  description?: string;
  displayName?: string;
  id: string;
  parameters?: ModelParamsSchema;
  pricePerImage?: number;
  pricing?: Pricing;
  releasedAt?: string;
}

export interface ImageGenerationProviderModels {
  id: string;
  models: ImageGenerationModelSummary[];
  name?: string;
}

export interface ListImageModelsParams {
  /**
   * Maximum models to return per provider.
   */
  limit?: number;
  /**
   * Provider id, for example `lobehub`, `openai`, or `fal`.
   */
  provider?: string;
}

export interface ListImageModelsState {
  providers: ImageGenerationProviderModels[];
  totalModels: number;
}

export interface GetImageModelParametersParams {
  model: string;
  provider: string;
}

export interface GetImageModelParametersState {
  defaultValues?: RuntimeImageGenParams;
  displayName?: string;
  model: string;
  parameters?: ModelParamsSchema;
  provider: string;
}

export interface GenerateImageParams {
  imageNum?: number;
  /**
   * Single reference image URL. Use only URLs already accessible to LobeHub.
   */
  imageUrl?: null | string;
  /**
   * Multiple reference image URLs. Use only URLs already accessible to LobeHub.
   */
  imageUrls?: string[];
  model?: string;
  parameters?: Partial<RuntimeImageGenParams> & Record<string, unknown>;
  prompt: string;
  provider?: string;
}

export interface GeneratedImageTask {
  asset?: Generation['asset'] | null;
  asyncTaskId: string;
  generationId: string;
  status?: AsyncTaskStatus;
}

export interface GenerateImageState {
  batchId?: string;
  generations: GeneratedImageTask[];
  generationTopicId: string;
  imageNum: number;
  model: string;
  prompt: string;
  provider: string;
}

export interface GetImageGenerationStatusParams {
  asyncTaskId: string;
  generationId: string;
}

export interface GetImageGenerationStatusState {
  asyncTaskId: string;
  error: AsyncTaskError | null;
  generation: Generation | null;
  generationId: string;
  status: AsyncTaskStatus;
}

export interface ImageGenerationCreateImagePayload {
  generationTopicId: string;
  imageNum: number;
  model: string;
  params: RuntimeImageGenParams & Record<string, unknown>;
  provider: string;
}

export interface ImageGenerationCreateImageResult {
  data?: {
    batch?: { id: string };
    generations?: Array<{
      asyncTaskId?: null | string;
      id: string;
    }>;
  };
  success?: boolean;
}
