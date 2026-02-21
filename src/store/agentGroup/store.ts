import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import { type StateCreator } from 'zustand/vanilla';

import { createDevtools } from '../middleware/createDevtools';
import { type ChatGroupAction } from './action';
import { chatGroupAction } from './action';
import { type ChatGroupState } from './initialState';
import { initialChatGroupState } from './initialState';

export type ChatGroupStore = ChatGroupState & ChatGroupAction;

const createStore: StateCreator<ChatGroupStore, [['zustand/devtools', never]]> = (
  ...params: Parameters<StateCreator<ChatGroupStore, [['zustand/devtools', never]]>>
) => ({
  ...initialChatGroupState,
  ...chatGroupAction(...params),
});

const devtools = createDevtools('agentGroup');

export const useAgentGroupStore = createWithEqualityFn<ChatGroupStore>()(
  devtools(createStore),
  shallow,
);

export const getChatGroupStoreState = () => useAgentGroupStore.getState();
