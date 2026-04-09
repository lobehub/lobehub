import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import { type StateCreator } from 'zustand/vanilla';

import { createDevtools } from '../middleware/createDevtools';
import { expose } from '../middleware/expose';
import { flattenActions } from '../utils/flattenActions';
import { type ResetableStore, ResetableStoreAction } from '../utils/resetableStore';
import { type MentionAction } from './action';
import { createMentionSlice } from './action';
import { type MentionState } from './initialState';
import { initialMentionState } from './initialState';

export type MentionStore = MentionState & MentionAction & ResetableStore;

class MentionStoreResetAction extends ResetableStoreAction<MentionStore> {
  protected readonly resetActionName = 'resetMentionStore';
}

const createStore: StateCreator<MentionStore, [['zustand/devtools', never]]> = (
  ...parameters: Parameters<StateCreator<MentionStore, [['zustand/devtools', never]]>>
) => ({
  ...initialMentionState,
  ...flattenActions<MentionAction & ResetableStore>([
    createMentionSlice(...parameters),
    new MentionStoreResetAction(...parameters),
  ]),
});

const devtools = createDevtools('mention');

export const useMentionStore = createWithEqualityFn<MentionStore>()(devtools(createStore), shallow);

expose('mention', useMentionStore);

export const getMentionStoreState = () => useMentionStore.getState();
