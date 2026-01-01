import { type StateCreator } from 'zustand/vanilla';

import { type ChatStore } from '@/store/chat/store';

import { type ChatGroupChatAction, agentGroupSlice } from './agentGroup';
import { type GroupOrchestrationAction, groupOrchestrationSlice } from './groupOrchestration';
import { type AgentAction, agentSlice } from './runAgent';

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface ChatAIAgentAction extends AgentAction, ChatGroupChatAction, GroupOrchestrationAction {
  /**/
}

export const chatAiAgent: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  ChatAIAgentAction
> = (...params) => ({
  ...agentSlice(...params),
  ...agentGroupSlice(...params),
  ...groupOrchestrationSlice(...params),
});
