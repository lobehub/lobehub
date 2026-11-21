import { type ConversationContext } from '@lobechat/types';

/**
 * Evict the persisted transcripts of conversations matching `predicate` (every
 * one when omitted), for stores outside the chat store that delete them.
 *
 * Transcripts persist in the message replica's IndexedDB rows, which never
 * expire, so once a topic / agent is deleted its transcript would orphan there
 * (and hydrate again) unless it is dropped explicitly. Nothing is refetched —
 * the conversation is gone. See `evictConversationMessages`.
 *
 * The chat store is loaded on demand: the session / home stores calling this
 * must not pull the whole chat store graph in at module load.
 *
 * @example
 * // every topic under a deleted agent
 * void evictMessageCache((ctx) => ctx.agentId === agentId);
 */
export const evictMessageCache = async (
  predicate?: (ctx: ConversationContext) => boolean,
): Promise<void> => {
  const { getChatStoreState } = await import('@/store/chat/store');
  await getChatStoreState().evictConversationMessages(predicate);
};
