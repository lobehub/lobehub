import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';

import { type TabItem } from '../types';
import { parseAgentTabContext } from '../url';

export const useTabUnread = (tab: TabItem): boolean =>
  useChatStore((s) => {
    const ctx = parseAgentTabContext(tab.url);
    if (!ctx) return false;
    if (ctx.topicId) return operationSelectors.isTopicUnreadCompleted(ctx.topicId)(s);
    return operationSelectors.isAgentUnreadCompleted(ctx.agentId)(s);
  });
