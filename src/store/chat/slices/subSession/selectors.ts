import type { ChatStoreState } from '@/store/chat/initialState';

import { subSessionTreeKey } from './projection';

const EMPTY: never[] = [];

/** The sub-sessions fetched for one sidebar page; empty until loaded. */
const treeOf = (openerTopicIds: readonly string[]) => (s: ChatStoreState) =>
  s.subSessionTreeMap[subSessionTreeKey(openerTopicIds)] ?? EMPTY;

/**
 * Whether `topicId` has sub-sessions on screen. Their receipts start the
 * topic's next turn on the server, so the open conversation watches for runs
 * it did not start.
 */
const hasSubSessions = (topicId: string | null | undefined) => (s: ChatStoreState) =>
  !!topicId &&
  Object.values(s.subSessionTreeMap).some((nodes) =>
    nodes.some((node) => node.openedBy?.topicId === topicId),
  );

export const subSessionSelectors = { hasSubSessions, treeOf };
