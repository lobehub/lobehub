/* eslint-disable sort-keys-fix/sort-keys-fix, typescript-sort-keys/interface */
import {
  type ModelParamsSchema,
  ModelProvider,
  type RuntimeImageGenParams,
  extractDefaultValues,
} from 'model-bank';
import { nanoBananaProParameters } from 'model-bank/google';

import { DEFAULT_IMAGE_CONFIG } from '@/const/settings';

export const DEFAULT_AI_IMAGE_PROVIDER = ModelProvider.Google;
export const DEFAULT_AI_IMAGE_MODEL = 'gemini-3-pro-image-preview:image';

export interface GenerationConfigState {
  parameters: RuntimeImageGenParams;
  parametersSchema: ModelParamsSchema;

  provider: string;
  model: string;
  imageNum: number;

  isAspectRatioLocked: boolean;
  activeAspectRatio: string | null; // string - 虚拟比例; null - 原生比例

  /**
   * 标记配置是否已初始化（包括从记忆中恢复）
   */
  isInit: boolean;
}

export const DEFAULT_IMAGE_GENERATION_PARAMETERS: RuntimeImageGenParams =
  extractDefaultValues(nanoBananaProParameters);

export const initialGenerationConfigState: GenerationConfigState = {
  model: DEFAULT_AI_IMAGE_MODEL,
  provider: DEFAULT_AI_IMAGE_PROVIDER,
  imageNum: DEFAULT_IMAGE_CONFIG.defaultImageNum,
  parameters: DEFAULT_IMAGE_GENERATION_PARAMETERS,
  parametersSchema: nanoBananaProParameters,
  isAspectRatioLocked: false,
  activeAspectRatio: null,
  isInit: false,
};
