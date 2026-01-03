import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import { type StateCreator } from 'zustand/vanilla';

import { createDevtools } from '../middleware/createDevtools';
import { type MentionAction, createMentionSlice } from './action';
import { type MentionState, initialMentionState } from './initialState';

export type MentionStore = MentionState & MentionAction;

const createStore: StateCreator<MentionStore, [['zustand/devtools', never]]> = (...parameters) => ({
  ...initialMentionState,
  ...createMentionSlice(...parameters),
});

const devtools = createDevtools('mention');

export const useMentionStore = createWithEqualityFn<MentionStore>()(devtools(createStore), shallow);

export const getMentionStoreState = () => useMentionStore.getState();
