import { subscribeWithSelector } from 'zustand/middleware';
import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import { type StateCreator } from 'zustand/vanilla';

import { createDevtools } from '../middleware/createDevtools';
import { initialState, type VideoStoreState } from './initialState';
import { createCreateVideoSlice, type CreateVideoAction } from './slices/createVideo/action';
import {
  createGenerationBatchSlice,
  type GenerationBatchAction,
} from './slices/generationBatch/action';
import {
  createGenerationConfigSlice,
  type GenerationConfigAction,
} from './slices/generationConfig/action';
import {
  createGenerationTopicSlice,
  type GenerationTopicAction,
} from './slices/generationTopic/action';

//  ===============  aggregate createStoreFn ============ //

export interface VideoStore
  extends
    GenerationConfigAction,
    GenerationTopicAction,
    GenerationBatchAction,
    CreateVideoAction,
    VideoStoreState {}

const createStore: StateCreator<VideoStore, [['zustand/devtools', never]]> = (...parameters) => ({
  ...initialState,
  ...createGenerationConfigSlice(...parameters),
  ...createGenerationTopicSlice(...parameters),
  ...createGenerationBatchSlice(...parameters),
  ...createCreateVideoSlice(...parameters),
});

//  ===============  implement useStore ============ //

const devtools = createDevtools('video');

export const useVideoStore = createWithEqualityFn<VideoStore>()(
  subscribeWithSelector(devtools(createStore)),
  shallow,
);

export const getVideoStoreState = () => useVideoStore.getState();
