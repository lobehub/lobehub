import type { ChatStoreState } from '@/store/chat/initialState';

import { subTopicTreeKey } from './projection';

const EMPTY: never[] = [];

/** The sub-topics fetched for one sidebar page; empty until loaded. */
const treeOf = (openerTopicIds: readonly string[]) => (s: ChatStoreState) =>
  s.subTopicTreeMap[subTopicTreeKey(openerTopicIds)] ?? EMPTY;

/**
 * Whether `topicId` has sub-topics on screen. Their receipts start the
 * topic's next turn on the server, so the open conversation watches for runs
 * it did not start.
 */
const hasSubTopics = (topicId: string | null | undefined) => (s: ChatStoreState) =>
  !!topicId &&
  Object.values(s.subTopicTreeMap).some((nodes) =>
    nodes.some((node) => node.openedBy?.topicId === topicId),
  );

export const subTopicSelectors = { hasSubTopics, treeOf };
