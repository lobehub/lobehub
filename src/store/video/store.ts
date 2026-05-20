import { subscribeWithSelector } from 'zustand/middleware';
import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import { type StateCreator } from 'zustand/vanilla';

import { createDevtools } from '../middleware/createDevtools';
import { expose } from '../middleware/expose';
import { flattenActions } from '../utils/flattenActions';
import { type ResetableStore, ResetableStoreAction } from '../utils/resetableStore';
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

type VideoStoreAction = GenerationConfigAction &
  GenerationTopicAction &
  GenerationBatchAction &
  CreateVideoAction &
  ResetableStore;

export interface VideoStore extends VideoStoreAction, VideoStoreState {}

class VideoStoreResetAction extends ResetableStoreAction<VideoStore> {
  protected readonly resetActionName = 'resetVideoStore';
}

const createStore: StateCreator<VideoStore, [['zustand/devtools', never]]> = (
  ...parameters: Parameters<StateCreator<VideoStore, [['zustand/devtools', never]]>>
) => ({
  ...initialState,
  ...flattenActions<VideoStoreAction>([
    createGenerationConfigSlice(...parameters),
    createGenerationTopicSlice(...parameters),
    createGenerationBatchSlice(...parameters),
    createCreateVideoSlice(...parameters),
    new VideoStoreResetAction(...parameters),
  ]),
});

//  ===============  implement useStore ============ //

const devtools = createDevtools('video');

export const useVideoStore = createWithEqualityFn<VideoStore>()(
  subscribeWithSelector(devtools(createStore)),
  shallow,
);

expose('video', useVideoStore);

export const getVideoStoreState = () => useVideoStore.getState();
