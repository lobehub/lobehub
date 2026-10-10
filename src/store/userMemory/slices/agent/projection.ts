import { defineReplica } from '@/libs/replica';
import { type RetrieveMemoryResult } from '@/types/userMemory';

/**
 * The memories retrieved for one topic (`topicMemoriesMap[topicId]`), injected
 * into the chat context.
 *
 * Keyed by the topic: the backend builds the query from the topic itself, so
 * the topic id is the whole entry identity. Read-only and persisted, so a
 * reload / a revisit paints the last confirmed bundle before the network only
 * confirms it — the chat send path reads it synchronously and must not wait on
 * a fetch.
 */
export const topicMemoriesResource = defineReplica<string, RetrieveMemoryResult>({
  key: (topicId) => topicId,
  name: 'userMemoryTopicMemories',
  storage: 'indexedDB',
  version: 1,
});
