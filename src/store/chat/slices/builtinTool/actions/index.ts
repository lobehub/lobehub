import { type StateCreator } from 'zustand/vanilla';

import { type ChatStore } from '@/store/chat/store';

import { type AgentBuilderAction, agentBuilderSlice } from './agentBuilder';
import { type GroupAgentBuilderAction, groupAgentBuilderSlice } from './groupAgentBuilder';
import { type ChatCodeInterpreterAction, codeInterpreterSlice } from './interpreter';
import { type KnowledgeBaseAction, knowledgeBaseSlice } from './knowledgeBase';
import { type LocalFileAction, localSystemSlice } from './localSystem';
import { type SearchAction, searchSlice } from './search';

export interface ChatBuiltinToolAction
  extends
    SearchAction,
    LocalFileAction,
    ChatCodeInterpreterAction,
    KnowledgeBaseAction,
    AgentBuilderAction,
    GroupAgentBuilderAction {}

export const chatToolSlice: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  ChatBuiltinToolAction
> = (...params) => ({
  ...searchSlice(...params),
  ...localSystemSlice(...params),
  ...codeInterpreterSlice(...params),
  ...knowledgeBaseSlice(...params),
  ...agentBuilderSlice(...params),
  ...groupAgentBuilderSlice(...params),
});
