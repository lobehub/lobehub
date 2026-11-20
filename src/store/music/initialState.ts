import { type CreateMusicState, initialCreateMusicState } from './slices/createMusic/initialState';
import {
  type GenerationBatchState,
  initialGenerationBatchState,
} from './slices/generationBatch/initialState';
import {
  initialGenerationConfigState,
  type MusicGenerationConfigState,
} from './slices/generationConfig/initialState';
import {
  type GenerationTopicState,
  initialGenerationTopicState,
} from './slices/generationTopic/initialState';

export type MusicStoreState = MusicGenerationConfigState &
  GenerationTopicState &
  GenerationBatchState &
  CreateMusicState;

export const initialState: MusicStoreState = {
  ...initialGenerationConfigState,
  ...initialGenerationTopicState,
  ...initialGenerationBatchState,
  ...initialCreateMusicState,
};
