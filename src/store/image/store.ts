import { subscribeWithSelector } from 'zustand/middleware';
import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import { type StateCreator } from 'zustand/vanilla';

import { createDevtools } from '../middleware/createDevtools';
import { flattenActions } from '../utils/flattenActions';
import { type ImageStoreState } from './initialState';
import { initialState } from './initialState';
import { type CreateImageAction } from './slices/createImage/action';
import { createCreateImageSlice } from './slices/createImage/action';
import { type GenerationBatchAction } from './slices/generationBatch/action';
import { createGenerationBatchSlice } from './slices/generationBatch/action';
import { type GenerationConfigAction } from './slices/generationConfig/action';
import { createGenerationConfigSlice } from './slices/generationConfig/action';
import { type GenerationTopicAction } from './slices/generationTopic/action';
import { createGenerationTopicSlice } from './slices/generationTopic/action';

//  ===============  aggregate createStoreFn ============ //

export interface ImageStore
  extends
    GenerationConfigAction,
    GenerationTopicAction,
    GenerationBatchAction,
    CreateImageAction,
    ImageStoreState {}

type ImageStoreAction = GenerationConfigAction &
  GenerationTopicAction &
  GenerationBatchAction &
  CreateImageAction;

const createStore: StateCreator<ImageStore, [['zustand/devtools', never]]> = (
  ...parameters: Parameters<StateCreator<ImageStore, [['zustand/devtools', never]]>>
) => ({
  ...initialState,
  ...flattenActions<ImageStoreAction>([
    createGenerationConfigSlice(...parameters),
    createGenerationTopicSlice(...parameters),
    createGenerationBatchSlice(...parameters),
    createCreateImageSlice(...parameters),
  ]),
});

//  ===============  implement useStore ============ //

const devtools = createDevtools('image');

export const useImageStore = createWithEqualityFn<ImageStore>()(
  subscribeWithSelector(devtools(createStore)),
  shallow,
);

export const getImageStoreState = () => useImageStore.getState();
