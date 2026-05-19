import { subscribeWithSelector } from 'zustand/middleware';
import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import { type StateCreator } from 'zustand/vanilla';

import { createDevtools } from '../middleware/createDevtools';
import { expose } from '../middleware/expose';
import { flattenActions } from '../utils/flattenActions';
import { type ResetableStore, ResetableStoreAction } from '../utils/resetableStore';
import { initialState, type AudioStoreState } from './initialState';
import { type CreateAudioAction, createCreateAudioSlice } from './slices/createAudio/action';
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

type AudioStoreAction = GenerationConfigAction &
  GenerationTopicAction &
  GenerationBatchAction &
  CreateAudioAction &
  ResetableStore;

export interface AudioStore extends AudioStoreAction, AudioStoreState {}

class AudioStoreResetAction extends ResetableStoreAction<AudioStore> {
  protected readonly resetActionName = 'resetAudioStore';
}

const createStore: StateCreator<AudioStore, [['zustand/devtools', never]]> = (
  ...parameters: Parameters<StateCreator<AudioStore, [['zustand/devtools', never]]>>
) => ({
  ...initialState,
  ...flattenActions<AudioStoreAction>([
    createGenerationConfigSlice(...parameters),
    createGenerationTopicSlice(...parameters),
    createGenerationBatchSlice(...parameters),
    createCreateAudioSlice(...parameters),
    new AudioStoreResetAction(...parameters),
  ]),
});

const devtools = createDevtools('audio');

export const useAudioStore = createWithEqualityFn<AudioStore>()(
  subscribeWithSelector(devtools(createStore)),
  shallow,
);

expose('audio', useAudioStore);

export const getAudioStoreState = () => useAudioStore.getState();
