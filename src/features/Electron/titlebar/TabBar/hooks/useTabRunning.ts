import {
  type AgentParams,
  type AgentTopicParams,
  type PageReference,
} from '@/features/Electron/titlebar/RecentlyViewed/types';
import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';

/**
 * Whether the agent runtime is generating in this tab's conversation context.
 * Only chat tabs (agent / agent-topic) can be "running"; other tab types return false.
 */
export const useTabRunning = (reference: PageReference): boolean =>
  useChatStore((s) => {
    if (reference.type === 'agent') {
      const { agentId } = reference.params as AgentParams;
      return operationSelectors.isAgentRuntimeRunningByContext({ agentId, topicId: null })(s);
    }
    if (reference.type === 'agent-topic') {
      const { agentId, topicId } = reference.params as AgentTopicParams;
      return operationSelectors.isAgentRuntimeRunningByContext({ agentId, topicId })(s);
    }
    return false;
  });
