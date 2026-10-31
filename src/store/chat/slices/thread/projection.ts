import type { ThreadItem } from '@lobechat/types';

import { defineReplica } from '@/libs/replica';

/**
 * Threads persisted for the topics the user opened most recently. Each topic is
 * one row, so this bounds how many rows a long history leaves in storage; the
 * topic on screen is pinned by its mounted `useSync`.
 */
export const MAX_PERSISTED_THREAD_LISTS = 100;

/**
 * Sub-threads of one topic (`threadMaps[topicId]`), so every existing selector
 * keeps reading the same place. A reload repaints the topic's thread list from
 * the local copy and revalidates it in the background.
 */
export const threadListResource = defineReplica<string, ThreadItem[]>({
  key: (topicId) => topicId,
  name: 'threadList',
  persist: { maxEntries: MAX_PERSISTED_THREAD_LISTS },
  storage: 'indexedDB',
  version: 1,
});
