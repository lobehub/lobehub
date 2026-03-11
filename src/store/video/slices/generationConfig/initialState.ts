/* eslint-disable perfectionist/sort-interfaces */
import {
  extractVideoDefaultValues,
  ModelProvider,
  type RuntimeVideoGenParams,
  type VideoModelParamsSchema,
} from 'model-bank';
import { seedance15ProParams } from 'model-bank/lobehub';

export const DEFAULT_AI_VIDEO_PROVIDER = ModelProvider.LobeHub;
export const DEFAULT_AI_VIDEO_MODEL = 'seedance-1-5-pro-251215';

export interface VideoGenerationConfigState {
  parameters: RuntimeVideoGenParams;
  parametersSchema: VideoModelParamsSchema;

  provider: string;
  model: string;

  /**
   * Marks whether the configuration has been initialized (including restoration from memory)
   */
  isInit: boolean;
}

export const DEFAULT_VIDEO_GENERATION_PARAMETERS: RuntimeVideoGenParams =
  extractVideoDefaultValues(seedance15ProParams);

export const initialGenerationConfigState: VideoGenerationConfigState = {
  model: DEFAULT_AI_VIDEO_MODEL,
  provider: DEFAULT_AI_VIDEO_PROVIDER,
  parameters: DEFAULT_VIDEO_GENERATION_PARAMETERS,
  parametersSchema: seedance15ProParams,
  isInit: false,
};
