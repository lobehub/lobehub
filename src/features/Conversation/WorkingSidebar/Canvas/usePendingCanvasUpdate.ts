import { useChatStore } from '@/store/chat';
import type { ChatStoreState } from '@/store/chat/initialState';
import { dbMessageSelectors } from '@/store/chat/slices/message/selectors';
import { operationSelectors } from '@/store/chat/slices/operation/selectors';

import { getCanvasUpdateStatus } from './pendingUpdate';

export const isActiveRunRunning = (s: ChatStoreState) =>
  operationSelectors.isAgentRuntimeRunningByContext({
    agentId: s.activeAgentId,
    groupId: s.activeGroupId,
    threadId: s.activeThreadId,
    topicId: s.activeTopicId,
  })(s);

export const usePendingCanvasUpdate = (canvasId?: string) =>
  useChatStore((s) => {
    if (!canvasId) return false;
    const status = getCanvasUpdateStatus(dbMessageSelectors.activeDbMessages(s), canvasId);
    return status === 'streaming' ? isActiveRunRunning(s) : status !== 'none';
  });
