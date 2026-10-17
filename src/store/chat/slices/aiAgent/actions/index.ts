import { type StateCreator } from 'zustand/vanilla';

import { type ChatStore } from '@/store/chat/store';
import { flattenActions } from '@/store/utils/flattenActions';

import { type TaskStatusPollingAction } from './taskStatusPolling';
import { TaskStatusPollingActionImpl } from './taskStatusPolling';

export type ChatAIAgentAction = TaskStatusPollingAction;

export const chatAiAgent: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  ChatAIAgentAction
> = (
  ...params: Parameters<
    StateCreator<ChatStore, [['zustand/devtools', never]], [], ChatAIAgentAction>
  >
) => flattenActions<ChatAIAgentAction>([new TaskStatusPollingActionImpl(...params)]);
