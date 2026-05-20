import {
  type AgentParams,
  type AgentTopicParams,
  type PageReference,
} from '@/features/Electron/titlebar/RecentlyViewed/types';
import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';

/**
 * Whether this tab has an unread completed generation.
 * Mirrors the sidebar agent badge, shown as a subtle dot on the tab.
 */
export const useTabUnread = (reference: PageReference): boolean =>
  useChatStore((s) => {
    if (reference.type === 'agent') {
      const { agentId } = reference.params as AgentParams;
      return operationSelectors.isAgentUnreadCompleted(agentId)(s);
    }
    if (reference.type === 'agent-topic') {
      const { topicId } = reference.params as AgentTopicParams;
      return operationSelectors.isTopicUnreadCompleted(topicId)(s);
    }
    return false;
  });
