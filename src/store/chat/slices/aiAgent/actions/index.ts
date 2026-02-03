import { type StateCreator } from 'zustand/vanilla';

import { type ChatStore } from '@/store/chat/store';
import { flattenActions } from '@/store/utils/flattenActions';

import { type ChatGroupChatAction, ChatGroupChatActionImpl } from './agentGroup';
import { type GroupOrchestrationAction, GroupOrchestrationActionImpl } from './groupOrchestration';
import { type AgentAction, AgentActionImpl } from './runAgent';

export type ChatAIAgentAction = AgentAction & ChatGroupChatAction & GroupOrchestrationAction;

// eslint-disable-next-line @typescript-eslint/no-empty-interface

export const chatAiAgent: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  ChatAIAgentAction
> = (
  ...params: Parameters<
    StateCreator<ChatStore, [['zustand/devtools', never]], [], ChatAIAgentAction>
  >
) =>
  flattenActions<ChatAIAgentAction>([
    new AgentActionImpl(...params),
    new ChatGroupChatActionImpl(...params),
    new GroupOrchestrationActionImpl(...params),
  ]);
