import { type CreateImageState, initialCreateImageState } from './slices/createImage/initialState';
import {
  type GenerationBatchState,
  initialGenerationBatchState,
} from './slices/generationBatch/initialState';
import {
  type GenerationConfigState,
  initialGenerationConfigState,
} from './slices/generationConfig/initialState';
import {
  type GenerationTopicState,
  initialGenerationTopicState,
} from './slices/generationTopic/initialState';

export type ImageStoreState = GenerationConfigState &
  GenerationTopicState &
  GenerationBatchState &
  CreateImageState;

export const initialState: ImageStoreState = {
  ...initialGenerationConfigState,
  ...initialGenerationTopicState,
  ...initialGenerationBatchState,
  ...initialCreateImageState,
};
