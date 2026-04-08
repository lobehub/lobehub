/* eslint-disable perfectionist/sort-interfaces */
import {
  extractVideoDefaultValues,
  ModelProvider,
  type RuntimeVideoGenParams,
  type VideoModelParamsSchema,
} from 'model-bank';
import { seedance20Params } from 'model-bank/lobehub';

export const DEFAULT_AI_VIDEO_PROVIDER = ModelProvider.LobeHub;
export const DEFAULT_AI_VIDEO_MODEL = 'doubao-seedance-2-0-260128';

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
  extractVideoDefaultValues(seedance20Params);

export const initialGenerationConfigState: VideoGenerationConfigState = {
  model: DEFAULT_AI_VIDEO_MODEL,
  provider: DEFAULT_AI_VIDEO_PROVIDER,
  parameters: DEFAULT_VIDEO_GENERATION_PARAMETERS,
  parametersSchema: seedance20Params,
  isInit: false,
};
