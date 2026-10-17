import { parse } from '@lobechat/conversation-flow';
import { type UIChatMessage } from '@lobechat/types';

import { type ReplicaLens } from '@/libs/replica';
import {
  type ConversationMessagePage,
  transcriptBucketOf,
  transcriptOf,
} from '@/services/message/replica';
import { type ChatStore } from '@/store/chat/store';

/** Paging bookkeeping of one transcript entry; its rows live in `dbMessagesMap`. */
export type TranscriptPaging = Omit<ConversationMessagePage, 'items'>;

const NO_PAGING = {} as TranscriptPaging;

const buckets = new Map<string, ReturnType<typeof transcriptBucketOf>>();

/** The bucket an entry key renders into (memoized: read on every streamed chunk). */
export const bucketOfKey = (key: string) => {
  let bucket = buckets.get(key);
  if (!bucket) buckets.set(key, (bucket = transcriptBucketOf(key)));
  return bucket;
};

const omitKey = <T>(record: Record<string, T>, key: string) => {
  if (!(key in record)) return record;
  const next = { ...record };
  delete next[key];
  return next;
};

/**
 * The chat store's transcript view: rows stay in `dbMessagesMap[bucket]` where
 * every reader expects them, the parsed `messagesMap[bucket]` is derived in the
 * same commit, and the paging bookkeeping sits beside them per entry key.
 */
export const createTranscriptLens = (): ReplicaLens<ChatStore, ConversationMessagePage> => {
  // Stable value identity per (rows, paging) pair, so repeated reads of an
  // unchanged entry compare equal.
  const views = new WeakMap<UIChatMessage[], WeakMap<object, ConversationMessagePage>>();
  const remember = (items: UIChatMessage[], paging: object, view: ConversationMessagePage) => {
    let byPaging = views.get(items);
    if (!byPaging) views.set(items, (byPaging = new WeakMap()));
    byPaging.set(paging, view);
    return view;
  };

  return {
    clear: (state) => {
      const dbMessagesMap = { ...state.dbMessagesMap };
      const messagesMap = { ...state.messagesMap };
      for (const key of Object.keys(state.messagePagingMap)) {
        const { bucket } = bucketOfKey(key);
        delete dbMessagesMap[bucket];
        delete messagesMap[bucket];
      }
      return { dbMessagesMap, messagePagingMap: {}, messagesMap };
    },
    get: (state, key) => {
      const items = state.dbMessagesMap[bucketOfKey(key).bucket];
      if (!items) return undefined;
      const paging = state.messagePagingMap[key];
      return (
        views.get(items)?.get(paging ?? NO_PAGING) ??
        remember(items, paging ?? NO_PAGING, paging ? { ...paging, items } : transcriptOf(items))
      );
    },
    keys: (state) => Object.keys(state.messagePagingMap),
    set: (state, key, data) => {
      const { bucket, threadId } = bucketOfKey(key);
      if (!data)
        return {
          dbMessagesMap: omitKey(state.dbMessagesMap, bucket),
          messagePagingMap: omitKey(state.messagePagingMap, key),
          messagesMap: omitKey(state.messagesMap, bucket),
        };

      const { items, ...paging } = data;
      remember(items, paging, data);
      const sameRows = state.dbMessagesMap[bucket] === items && !!state.messagesMap[bucket];
      return {
        dbMessagesMap: sameRows ? state.dbMessagesMap : { ...state.dbMessagesMap, [bucket]: items },
        messagePagingMap: { ...state.messagePagingMap, [key]: paging },
        // The key's thread decides which threaded rows render (see conversation-flow `ThreadScope`).
        messagesMap: sameRows
          ? state.messagesMap
          : {
              ...state.messagesMap,
              [bucket]: parse(items, undefined, { threadId: threadId ?? undefined }).flatList,
            },
      };
    },
  };
};
