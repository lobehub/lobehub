import { type CreateVideoState, initialCreateVideoState } from './slices/createVideo/initialState';
import {
  type GenerationBatchState,
  initialGenerationBatchState,
} from './slices/generationBatch/initialState';
import {
  type VideoGenerationConfigState,
  initialGenerationConfigState,
} from './slices/generationConfig/initialState';
import {
  type GenerationTopicState,
  initialGenerationTopicState,
} from './slices/generationTopic/initialState';

export type VideoStoreState = VideoGenerationConfigState &
  GenerationTopicState &
  GenerationBatchState &
  CreateVideoState;

export const initialState: VideoStoreState = {
  ...initialGenerationConfigState,
  ...initialGenerationTopicState,
  ...initialGenerationBatchState,
  ...initialCreateVideoState,
};
