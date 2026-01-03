import { subscribeWithSelector } from 'zustand/middleware';
import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import { type StateCreator } from 'zustand/vanilla';

import { createDevtools } from '../middleware/createDevtools';
import { type ImageStoreState, initialState } from './initialState';
import { type CreateImageAction, createCreateImageSlice } from './slices/createImage/action';
import { type GenerationBatchAction, createGenerationBatchSlice } from './slices/generationBatch/action';
import {
  type GenerationConfigAction,
  createGenerationConfigSlice,
} from './slices/generationConfig/action';
import { type GenerationTopicAction, createGenerationTopicSlice } from './slices/generationTopic/action';

//  ===============  aggregate createStoreFn ============ //

export interface ImageStore
  extends GenerationConfigAction,
    GenerationTopicAction,
    GenerationBatchAction,
    CreateImageAction,
    ImageStoreState {}

const createStore: StateCreator<ImageStore, [['zustand/devtools', never]]> = (...parameters) => ({
  ...initialState,
  ...createGenerationConfigSlice(...parameters),
  ...createGenerationTopicSlice(...parameters),
  ...createGenerationBatchSlice(...parameters),
  ...createCreateImageSlice(...parameters),
});

//  ===============  implement useStore ============ //

const devtools = createDevtools('image');

export const useImageStore = createWithEqualityFn<ImageStore>()(
  subscribeWithSelector(devtools(createStore)),
  shallow,
);

export const getImageStoreState = () => useImageStore.getState();
