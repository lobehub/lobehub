import { type CreateAudioState, initialCreateAudioState } from './slices/createAudio/initialState';
import {
  type GenerationBatchState,
  initialGenerationBatchState,
} from './slices/generationBatch/initialState';
import {
  type AudioGenerationConfigState,
  initialGenerationConfigState,
} from './slices/generationConfig/initialState';
import {
  type GenerationTopicState,
  initialGenerationTopicState,
} from './slices/generationTopic/initialState';

export type AudioStoreState = AudioGenerationConfigState &
  GenerationTopicState &
  GenerationBatchState &
  CreateAudioState;

export const initialState: AudioStoreState = {
  ...initialGenerationConfigState,
  ...initialGenerationTopicState,
  ...initialGenerationBatchState,
  ...initialCreateAudioState,
};
