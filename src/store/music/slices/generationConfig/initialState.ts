/* eslint-disable perfectionist/sort-interfaces */
import { ModelProvider } from 'model-bank/modelProvider';
import {
  extractMusicDefaultValues,
  type MusicModelParamsSchema,
  type RuntimeMusicGenParams,
} from 'model-bank/standardParameters';

export const DEFAULT_AI_MUSIC_PROVIDER = ModelProvider.Suno;
export const DEFAULT_AI_MUSIC_MODEL = 'suno-v6';

/**
 * Placeholder schema until the enabled model list loads: a prompt-only model, so the page never
 * shows a parameter the selected model may not support.
 */
const promptOnlyParams: MusicModelParamsSchema = {
  prompt: { default: '' },
};

export interface MusicGenerationConfigState {
  parameters: RuntimeMusicGenParams;
  parametersSchema: MusicModelParamsSchema;

  provider: string;
  model: string;

  /** Name of the reference audio file being uploaded, for the upload button loading state */
  uploadingReferenceAudio?: string;

  /**
   * Marks whether the configuration has been initialized (including restoration from memory)
   */
  isInit: boolean;
}

export const DEFAULT_MUSIC_GENERATION_PARAMETERS: RuntimeMusicGenParams =
  extractMusicDefaultValues(promptOnlyParams);

export const initialGenerationConfigState: MusicGenerationConfigState = {
  model: DEFAULT_AI_MUSIC_MODEL,
  provider: DEFAULT_AI_MUSIC_PROVIDER,
  parameters: DEFAULT_MUSIC_GENERATION_PARAMETERS,
  parametersSchema: promptOnlyParams,
  uploadingReferenceAudio: undefined,
  isInit: false,
};
