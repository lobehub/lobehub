import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';

import { type TabItem } from '../types';
import { parseAgentTabContext } from '../url';

export const useTabRunning = (tab: TabItem): boolean =>
  useChatStore((s) => {
    const ctx = parseAgentTabContext(tab.url);
    if (!ctx) return false;
    return operationSelectors.isAgentRuntimeVisiblyRunningByContext({
      agentId: ctx.agentId,
      topicId: ctx.topicId,
    })(s);
  });
