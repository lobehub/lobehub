import { type StateCreator } from 'zustand/vanilla';

import { type ChatStore } from '@/store/chat/store';

import { type AgentBuilderAction, agentBuilderSlice } from './agentBuilder';
import { type GroupAgentBuilderAction, groupAgentBuilderSlice } from './groupAgentBuilder';
import { type ChatCodeInterpreterAction, codeInterpreterSlice } from './interpreter';
import { type SearchAction, searchSlice } from './search';

export interface ChatBuiltinToolAction
  extends SearchAction, ChatCodeInterpreterAction, AgentBuilderAction, GroupAgentBuilderAction {}

export const chatToolSlice: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  ChatBuiltinToolAction
> = (...params) => ({
  ...searchSlice(...params),
  ...codeInterpreterSlice(...params),
  ...agentBuilderSlice(...params),
  ...groupAgentBuilderSlice(...params),
});
