import { useMemo } from 'react';

import { useChatStore } from '@/store/chat';
import type { ChatStoreState } from '@/store/chat/initialState';
import { dbMessageSelectors } from '@/store/chat/selectors';

import { collectBackgroundTasks, findLiveOperation } from './backgroundTaskList';

interface LiveOperation {
  id: string;
  metadata: { serverOperationId?: string };
  status: string;
}

/**
 * The ids of every running operation, as one string: a stable selector value,
 * so streaming updates to an operation's metadata do not rerender the section.
 */
const liveOperationsKey = (s: ChatStoreState): string =>
  Object.values(s.operations)
    .filter((op) => op.status === 'running' || op.status === 'paused')
    .map((op) => `${op.id}\u0000${op.metadata?.serverOperationId ?? ''}`)
    .sort()
    .join('\u0001');

const parseLiveOperations = (key: string): LiveOperation[] =>
  key
    ? key.split('\u0001').map((entry) => {
        const [id, serverOperationId] = entry.split('\u0000');
        return {
          id,
          metadata: serverOperationId ? { serverOperationId } : {},
          status: 'running',
        };
      })
    : [];

/** The conversation's background tasks, and the runs still alive in this client. */
export const useBackgroundTasks = () => {
  const messages = useChatStore(dbMessageSelectors.activeDbMessages);
  const liveKey = useChatStore(liveOperationsKey);

  return useMemo(() => {
    const liveOperations = parseLiveOperations(liveKey);
    const items = collectBackgroundTasks(
      messages,
      (operationId) => !!findLiveOperation(liveOperations, operationId),
    );
    return { items, liveOperations };
  }, [liveKey, messages]);
};
