import { type RetrieveMemoryResult } from '@/types/userMemory';

import { defineUserMemoryReplica, MAX_RECENT_TOPIC_MEMORIES } from '../../utils/replica';

/**
 * The memories retrieved for one topic (`topicMemoriesMap[topicId]`), injected
 * into the chat context.
 *
 * Keyed by the topic: the backend builds the query from the topic itself, so
 * the topic id is the whole entry identity. Read-only and persisted, so a
 * reload / a revisit paints the last confirmed bundle before the network only
 * confirms it — the chat send path reads it synchronously and must not wait on
 * a fetch. Scoped per user (see `userMemoryIdentityScope`), and bounded to the
 * most recently visited topics (`MAX_RECENT_TOPIC_MEMORIES`).
 */
export const topicMemoriesResource = defineUserMemoryReplica<string, RetrieveMemoryResult>({
  key: (topicId) => topicId,
  name: 'userMemoryTopicMemories',
  persist: { maxEntries: MAX_RECENT_TOPIC_MEMORIES },
  storage: 'indexedDB',
  version: 1,
});
