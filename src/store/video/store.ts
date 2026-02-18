import { subscribeWithSelector } from 'zustand/middleware';
import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import { type StateCreator } from 'zustand/vanilla';

import { createDevtools } from '../middleware/createDevtools';
import { type VideoStoreState, initialState } from './initialState';
import { type CreateVideoAction, createCreateVideoSlice } from './slices/createVideo/action';
import {
  type GenerationBatchAction,
  createGenerationBatchSlice,
} from './slices/generationBatch/action';
import {
  type GenerationConfigAction,
  createGenerationConfigSlice,
} from './slices/generationConfig/action';
import {
  type GenerationTopicAction,
  createGenerationTopicSlice,
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
