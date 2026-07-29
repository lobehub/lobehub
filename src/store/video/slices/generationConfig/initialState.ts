/* eslint-disable perfectionist/sort-interfaces */
import {
  extractVideoDefaultValues,
  ModelProvider,
  PRESET_VIDEO_ASPECT_RATIOS,
  PRESET_VIDEO_RESOLUTIONS,
  type RuntimeVideoGenParams,
  type VideoModelParamsSchema,
} from 'model-bank';

export const DEFAULT_AI_VIDEO_PROVIDER = ModelProvider.LobeHub;
export const DEFAULT_AI_VIDEO_MODEL = 'dreamina-seedance-2-0-260128';

const seedance20Params: VideoModelParamsSchema = {
  aspectRatio: {
    default: 'adaptive',
    enum: ['adaptive', ...PRESET_VIDEO_ASPECT_RATIOS],
  },
  duration: { default: 5, max: 15, min: 4 },
  endImageUrl: {
    aspectRatio: { max: 2.5, min: 0.4 },
    default: null,
    height: { max: 6000, min: 300 },
    maxFileSize: 30 * 1024 * 1024,
    requiresImageUrl: true,
    width: { max: 6000, min: 300 },
  },
  generateAudio: { default: true },
  imageUrls: {
    aspectRatio: { max: 2.5, min: 0.4 },
    default: [],
    height: { max: 6000, min: 300 },
    maxCount: 9,
    maxFileSize: 30 * 1024 * 1024,
    width: { max: 6000, min: 300 },
  },
  prompt: { default: '' },
  resolution: {
    default: '720p',
    enum: PRESET_VIDEO_RESOLUTIONS,
  },
  seed: { default: null },
};

export interface VideoGenerationConfigState {
  parameters: RuntimeVideoGenParams;
  parametersSchema: VideoModelParamsSchema;

  provider: string;
  model: string;

  /**
   * Object-URL previews for reference images currently being uploaded. Shared
   * across the inline reference frames and the page-level drag-upload zone so
   * both surfaces show the same in-flight loading placeholders.
   */
  uploadingImagePreviews: string[];

  /**
   * Marks whether the configuration has been initialized (including restoration from memory)
   */
  isInit: boolean;
}

export const DEFAULT_VIDEO_GENERATION_PARAMETERS: RuntimeVideoGenParams =
  extractVideoDefaultValues(seedance20Params);

export const initialGenerationConfigState: VideoGenerationConfigState = {
  model: DEFAULT_AI_VIDEO_MODEL,
  provider: DEFAULT_AI_VIDEO_PROVIDER,
  parameters: DEFAULT_VIDEO_GENERATION_PARAMETERS,
  parametersSchema: seedance20Params,
  uploadingImagePreviews: [],
  isInit: false,
};
