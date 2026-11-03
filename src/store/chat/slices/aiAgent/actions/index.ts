import { type StateCreator } from 'zustand/vanilla';

import { type ChatStore } from '@/store/chat/store';
import { flattenActions } from '@/store/utils/flattenActions';

import { type GroupOrchestrationAction } from './groupOrchestration';
import { GroupOrchestrationActionImpl } from './groupOrchestration';

export type ChatAIAgentAction = GroupOrchestrationAction;

export const chatAiAgent: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  ChatAIAgentAction
> = (
  ...params: Parameters<
    StateCreator<ChatStore, [['zustand/devtools', never]], [], ChatAIAgentAction>
  >
) => flattenActions<ChatAIAgentAction>([new GroupOrchestrationActionImpl(...params)]);
