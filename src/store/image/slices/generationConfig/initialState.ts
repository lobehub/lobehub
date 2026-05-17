import { type ModelParamsSchema, type RuntimeImageGenParams } from 'model-bank';
import { extractDefaultValues, ModelProvider } from 'model-bank';

import { DEFAULT_IMAGE_CONFIG } from '@/const/settings';

export const DEFAULT_AI_IMAGE_PROVIDER = ModelProvider.Google;
export const DEFAULT_AI_IMAGE_MODEL = 'gemini-3.1-flash-image-preview:image';

const nanoBanana2Parameters: ModelParamsSchema = {
  aspectRatio: {
    default: 'auto',
    enum: [
      'auto',
      '1:1',
      '2:3',
      '3:2',
      '3:4',
      '4:3',
      '4:5',
      '5:4',
      '9:16',
      '16:9',
      '21:9',
      '1:4',
      '4:1',
      '1:8',
      '8:1',
    ],
  },
  imageUrls: {
    default: [],
  },
  prompt: { default: '' },
  resolution: {
    default: '1K',
    enum: ['512', '1K', '2K', '4K'],
  },
};

export interface GenerationConfigState {
  parameters: RuntimeImageGenParams;
  parametersSchema: ModelParamsSchema;

  provider: string;
  model: string;
  imageNum: number;

  isAspectRatioLocked: boolean;
  activeAspectRatio: string | null; // string - virtual ratio; null - native ratio

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
  isInit: false,
};
