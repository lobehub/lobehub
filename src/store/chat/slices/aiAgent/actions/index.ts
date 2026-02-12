import { type StateCreator } from 'zustand/vanilla';

import { type ChatStore } from '@/store/chat/store';
import { flattenActions } from '@/store/utils/flattenActions';

import { type ChatGroupChatAction } from './agentGroup';
import { ChatGroupChatActionImpl } from './agentGroup';
import { type GroupOrchestrationAction } from './groupOrchestration';
import { GroupOrchestrationActionImpl } from './groupOrchestration';
import { type AgentAction } from './runAgent';
import { AgentActionImpl } from './runAgent';

export type ChatAIAgentAction = AgentAction & ChatGroupChatAction & GroupOrchestrationAction;

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
