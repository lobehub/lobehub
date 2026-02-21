import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import { type StateCreator } from 'zustand/vanilla';

import { createDevtools } from '../middleware/createDevtools';
import { flattenActions } from '../utils/flattenActions';
import { type MentionAction } from './action';
import { createMentionSlice } from './action';
import { type MentionState } from './initialState';
import { initialMentionState } from './initialState';

export type MentionStore = MentionState & MentionAction;

const createStore: StateCreator<MentionStore, [['zustand/devtools', never]]> = (
  ...parameters: Parameters<StateCreator<MentionStore, [['zustand/devtools', never]]>>
) => ({
  ...initialMentionState,
  ...flattenActions<MentionAction>([createMentionSlice(...parameters)]),
});

const devtools = createDevtools('mention');

export const useMentionStore = createWithEqualityFn<MentionStore>()(devtools(createStore), shallow);

export const getMentionStoreState = () => useMentionStore.getState();
