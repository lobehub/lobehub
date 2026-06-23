import { type ConversationContext } from '@lobechat/types';

import { mutate } from '@/libs/swr';
import { messageKeys } from '@/libs/swr/keys';

/**
 * Evict persisted `message:list` cache entries whose conversation context
 * matches `predicate`.
 *
 * The IndexedDB cache tier never expires (see `localStorageProvider`), so once a
 * topic / agent is deleted its message cache would orphan in IndexedDB forever
 * unless we drop it explicitly. Clears the cached value without revalidating —
 * the conversation is gone, there is nothing left to refetch.
 *
 * Matches every `message:list` variant (any page-size / version / workspace-
 * augmented key) sharing the same `ConversationContext`, mirroring the matcher
 * used by `refreshMessages` / the write-through cache.
 *
 * @example
 * // a single deleted topic
 * void evictMessageCache((ctx) => ctx.topicId === topicId);
 * // every topic under a deleted agent
 * void evictMessageCache((ctx) => ctx.agentId === agentId);
 * // wipe everything (delete-all)
 * void evictMessageCache(() => true);
 */
export const evictMessageCache = (
  predicate: (ctx: ConversationContext) => boolean,
): Promise<unknown> =>
  mutate(
    (key) => {
      if (!Array.isArray(key) || key[0] !== messageKeys.list.root) return false;
      const ctx = key[1] as ConversationContext | undefined;
      return !!ctx && predicate(ctx);
    },
    undefined,
    { revalidate: false },
  );
