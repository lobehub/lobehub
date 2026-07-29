import type { ModelParamsSchema, RuntimeImageGenParams } from 'model-bank';
import { extractDefaultValues, ModelProvider } from 'model-bank';
import { nanoBanana2Parameters } from 'model-bank/imageParameters';

import { DEFAULT_IMAGE_CONFIG } from '@/const/settings';

export const DEFAULT_AI_IMAGE_PROVIDER = ModelProvider.Google;
export const DEFAULT_AI_IMAGE_MODEL = 'gemini-3.1-flash-image-preview:image';

export interface GenerationConfigState {
  parameters: RuntimeImageGenParams;
  parametersSchema: ModelParamsSchema;

  provider: string;
  model: string;
  imageNum: number;

  isAspectRatioLocked: boolean;
  activeAspectRatio: string | null; // string - virtual ratio; null - native ratio

  /**
   * Object-URL previews for reference images currently being uploaded. Shared
   * across the inline reference cards and the page-level drag-upload zone so
   * both surfaces show the same in-flight loading placeholders.
   */
  uploadingImagePreviews: string[];

  /**
   * Marks whether the configuration has been initialized (including restoration from memory)
   */
  isInit: boolean;
}

export const DEFAULT_IMAGE_GENERATION_PARAMETERS: RuntimeImageGenParams =
  extractDefaultValues(nanoBanana2Parameters);

export const initialGenerationConfigState: GenerationConfigState = {
  model: DEFAULT_AI_IMAGE_MODEL,
  provider: DEFAULT_AI_IMAGE_PROVIDER,
  imageNum: DEFAULT_IMAGE_CONFIG.defaultImageNum,
  parameters: DEFAULT_IMAGE_GENERATION_PARAMETERS,
  parametersSchema: nanoBanana2Parameters,
  isAspectRatioLocked: false,
  activeAspectRatio: null,
  uploadingImagePreviews: [],
  isInit: false,
};
