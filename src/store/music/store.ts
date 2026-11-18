import { subscribeWithSelector } from 'zustand/middleware';
import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import { type StateCreator } from 'zustand/vanilla';

import { createDevtools } from '../middleware/createDevtools';
import { expose } from '../middleware/expose';
import { flattenActions } from '../utils/flattenActions';
import { type ResetableStore, ResetableStoreAction } from '../utils/resetableStore';
import { initialState, type MusicStoreState } from './initialState';
import { createCreateMusicSlice, type CreateMusicAction } from './slices/createMusic/action';
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

type MusicStoreAction = GenerationConfigAction &
  GenerationTopicAction &
  GenerationBatchAction &
  CreateMusicAction &
  ResetableStore;

export interface MusicStore extends MusicStoreAction, MusicStoreState {}

class MusicStoreResetAction extends ResetableStoreAction<MusicStore> {
  protected readonly resetActionName = 'resetMusicStore';
}

const createStore: StateCreator<MusicStore, [['zustand/devtools', never]]> = (
  ...parameters: Parameters<StateCreator<MusicStore, [['zustand/devtools', never]]>>
) => ({
  ...initialState,
  ...flattenActions<MusicStoreAction>([
    createGenerationConfigSlice(...parameters),
    createGenerationTopicSlice(...parameters),
    createGenerationBatchSlice(...parameters),
    createCreateMusicSlice(...parameters),
    new MusicStoreResetAction(...parameters),
  ]),
});

//  ===============  implement useStore ============ //

const devtools = createDevtools('music');

export const useMusicStore = createWithEqualityFn<MusicStore>()(
  subscribeWithSelector(devtools(createStore)),
  shallow,
);

expose('music', useMusicStore);

export const getMusicStoreState = () => useMusicStore.getState();
