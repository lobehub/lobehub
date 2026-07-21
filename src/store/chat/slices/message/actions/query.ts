import { parse } from '@lobechat/conversation-flow';
import { type ConversationContext, type UIChatMessage } from '@lobechat/types';
import debug from 'debug';
import isEqual from 'fast-deep-equal';
import { type SWRResponse } from 'swr';

import { mutate, useClientDataSWRWithSync } from '@/libs/swr';
import { isMessageListKey } from '@/libs/swr/keys';
import { messageService } from '@/services/message';
import {
  getMessageListCacheIdentity,
  getMessageListFetchPolicy,
  invalidateMessageListClientState,
  isMessageListServerVerified,
  messageListKey,
  runMessageListQuery,
} from '@/services/message/cache';
import { operationSelectors } from '@/store/chat/slices/operation/selectors';
import { type ChatStore } from '@/store/chat/store';
import { type StoreSetter } from '@/store/types';

import { type MessageMapKeyInput } from '../../../utils/messageMapKey';
import { messageMapKey } from '../../../utils/messageMapKey';
import { reconcileAssistantToolLinks } from '../utils/reconcileTools';

/**
 * Data query and synchronization actions
 * Handles fetching, refreshing, and replacing message data
 */

const prefetchingMessageKeys = new Set<string>();
const log = debug('lobe-client:message-query');

type Setter = StoreSetter<ChatStore>;
export const messageQuery = (set: Setter, get: () => ChatStore, _api?: unknown) =>
  new MessageQueryActionImpl(set, get, _api);

export class MessageQueryActionImpl {
  readonly #get: () => ChatStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => ChatStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  revalidateMessages = async (context?: Partial<ConversationContext>): Promise<void> => {
    const agentId = context?.agentId ?? this.#get().activeAgentId;
    const topicId = context?.topicId !== undefined ? context.topicId : this.#get().activeTopicId;
    const groupId = context?.groupId !== undefined ? context.groupId : this.#get().activeGroupId;
    const threadId =
      context?.threadId !== undefined ? context.threadId : this.#get().activeThreadId;

    // Topic navigation is a soft ensure: a completed prefetch is already the
    // server snapshot the destination hook needs, while an in-flight prefetch
    // will be shared by the coordinator when the hook mounts.
    if (isMessageListServerVerified({ agentId, groupId, threadId, topicId })) return;

    await mutate(messageListKey({ agentId, groupId, threadId, topicId }));
  };

  refreshMessages = async (context?: Partial<ConversationContext>): Promise<void> => {
    const agentId = context?.agentId ?? this.#get().activeAgentId;
    const topicId = context?.topicId !== undefined ? context.topicId : this.#get().activeTopicId;

    // A force refresh owns both invalidation layers. Do this synchronously
    // before SWR mutate so an inactive key with no subscriber still loses its
    // verification window and any older in-flight generation.
    invalidateMessageListClientState((ctx) => ctx.agentId === agentId && ctx.topicId === topicId);

    // Invalidate every `message:list` entry for this agent+topic (any scope /
    // thread / page-size variant).
    await mutate((key) =>
      isMessageListKey(key, (ctx) => ctx.agentId === agentId && ctx.topicId === topicId),
    );
  };

  prefetchMessages = async (context: ConversationContext): Promise<void> => {
    if (!context.agentId || !context.topicId) return;

    const messagesKey = getMessageListCacheIdentity(context);
    if (operationSelectors.isAgentRuntimeRunningByContext(context)(this.#get())) return;
    if (isMessageListServerVerified(context)) return;
    if (prefetchingMessageKeys.has(messagesKey)) return;

    prefetchingMessageKeys.add(messagesKey);

    const request = runMessageListQuery(context, messageService.getMessages).then((messages) => {
      this.#get().replaceMessages(messages, { action: 'prefetchMessages', context });
      return messages;
    });

    try {
      await mutate(messageListKey(context), request, { revalidate: false });
      await request;
    } catch (error) {
      // Background warming should never surface an unhandled rejection.
      log('Failed to warm the message cache: %O', error);
    } finally {
      prefetchingMessageKeys.delete(messagesKey);
    }
  };

  replaceMessages = (
    messages: UIChatMessage[],
    params?: {
      action?: any;

      context?: Partial<ConversationContext>;

      operationId?: string;

      /**
       * Graft `works` from the currently stored messages onto the incoming
       * ones (by message id). Set when the payload was fetched with
       * `skipWorks` (mid-stream refetches / step_start snapshots), so
       * already-rendered Work chips don't flicker away until the terminal
       * refetch restores them.
       */
      preserveWorks?: boolean;
    },
  ): void => {
    let ctx: MessageMapKeyInput;

    // Priority 1: Use explicit context if provided (preserving scope)
    if (params?.context) {
      // Spread the whole context so every bucket-key field carries through —
      // notably `documentId` (page scope: keeps writes in the
      // `page_<agent>_<documentId>` bucket the editor reads from, instead of
      // `page_<agent>_new`) and `subAgentId` (group_agent scope's subTopicId).
      // Only agentId/topicId need a fallback to the active conversation.
      ctx = {
        ...params.context,
        agentId: params.context.agentId ?? this.#get().activeAgentId,
        topicId:
          params.context.topicId !== undefined ? params.context.topicId : this.#get().activeTopicId,
      };
    }
    // Priority 2: Get full context from operation if operationId is provided (deprecated)
    else if (params?.operationId) {
      ctx = this.#get().internal_getConversationContext(params);
    }
    // Priority 3: Fallback to global state
    else {
      ctx = {
        agentId: this.#get().activeAgentId,
        groupId: this.#get().activeGroupId,
        threadId: this.#get().activeThreadId,
        topicId: this.#get().activeTopicId,
      };
    }

    const messagesKey = messageMapKey(ctx);

    let incoming = messages;
    if (params?.preserveWorks) {
      const worksById = new Map(
        (this.#get().dbMessagesMap[messagesKey] ?? [])
          .filter((message) => message.works?.length)
          .map((message) => [message.id, message.works]),
      );
      if (worksById.size > 0) {
        incoming = messages.map((message) =>
          !message.works && worksById.has(message.id)
            ? { ...message, works: worksById.get(message.id) }
            : message,
        );
      }
    }

    // Re-link any tool row whose parent assistant lost its tools[] entry before
    // it lands in the raw bucket — a stale / out-of-order snapshot can drop the
    // link while the tool row survives, which would orphan the tool bubble (see
    // reconcileAssistantToolLinks). Keeps dbMessagesMap (SoT) consistent for
    // optimistic updates, not just the parsed display.
    const reconciled = reconcileAssistantToolLinks(incoming);

    // Get raw messages from dbMessagesMap and apply reducer
    const nextDbMap = { ...this.#get().dbMessagesMap, [messagesKey]: reconciled };

    // Write through BEFORE the equality early-return below. Optimistic flows
    // (optimisticUpdateMessageContent / optimisticDeleteMessage[s]) call
    // `internal_dispatchMessage` first — which already applies the mutation to
    // `dbMessagesMap` WITHOUT touching the SWR cache — and then
    // `replaceMessages(result.messages)`. When the server echo equals the
    // already-applied in-memory state, the `isEqual` return fires and the
    // store-set is correctly skipped; but the SWR/IndexedDB cache was never
    // updated by the dispatch, so a later remount would hydrate the
    // pre-mutation snapshot (stale content / deleted rows). Seeding here keeps
    // the cache correct even on a store no-op.
    this.#writeThroughMessageCache(ctx, messagesKey, reconciled, params?.action);

    if (isEqual(nextDbMap, this.#get().dbMessagesMap)) return;

    // Parse messages using conversation-flow
    const { flatList } = parse(reconciled);

    this.#set(
      {
        // Store raw messages from backend
        dbMessagesMap: nextDbMap,
        // Store parsed messages for display
        messagesMap: { ...this.#get().messagesMap, [messagesKey]: flatList },
      },
      false,
      params?.action ?? 'replaceMessages',
    );
  };

  /**
   * Write settled in-memory messages back into the canonical `message:list`
   * SWR cache (and, transitively, the persisted IndexedDB tier).
   *
   * Why: message mutations otherwise only touch the in-memory store, so the SWR
   * cache stays stale until a network refetch. Because the Conversation store is
   * recreated on every topic/session switch and re-hydrates from this cache, a
   * stale cache is what forces a refetch on every switch. Keeping the cache in
   * sync here lets a switch-back hydrate immediately while the independent
   * server-verification policy decides whether to revalidate.
   *
   * Called even when the `replaceMessages` store-set is a no-op (see caller),
   * because an optimistic dispatch may have already applied this exact state to
   * the store while leaving the cache stale.
   *
   * Skipped in four cases:
   * - contexts the canonical `message:list` key cannot represent — scoped
   *   buckets such as page copilot (`documentId`) or group-agent streams
   *   (`subAgentId`) carry a local-only discriminator that
   *   `normalizeMessageListQueryContext` drops, so seeding the canonical key
   *   would persist the scoped transcript under the ordinary conversation
   *   entry and a later mount of THAT conversation would hydrate it.
   * - `useFetchMessages` onData — SWR already holds that exact value, so
   *   re-writing it would double the IndexedDB persist on every fetch.
   * - `prefetchMessages` — the exact cache key is seeded by the prefetch
   *   mutate call itself, while replaceMessages only hydrates ChatStore.
   * - while the context is streaming — `internal_dispatchMessage` bridges every
   *   token here via `onMessagesChange`, and a write-through per token would
   *   thrash. `agent_runtime_end` clears the running flag *before* its final
   *   `replaceMessages`, so the settled snapshot still writes through.
   */
  #writeThroughMessageCache = (
    ctx: MessageMapKeyInput,
    messagesKey: string,
    messages: UIChatMessage[],
    action?: string,
  ): void => {
    if (!ctx.agentId || !ctx.topicId) return;
    if (operationSelectors.isAgentRuntimeRunningByContext(ctx)(this.#get())) return;
    if (action === 'useFetchMessages' || action === 'prefetchMessages') return;

    // The server `message:list` key only carries agentId/groupId/threadId/
    // topicId (see `normalizeMessageListQueryContext`). When the bucket key
    // needs more than those fields (page `documentId`, group-agent
    // `subAgentId`, `isNew`, an isolating `scope`, …) this context cannot be
    // represented by the canonical key — write nothing rather than store the
    // scoped transcript under the ordinary conversation entry.
    const representableBucketKey = messageMapKey({
      agentId: ctx.agentId,
      groupId: ctx.groupId,
      scope: ctx.threadId ? 'thread' : ctx.groupId ? 'group' : 'main',
      threadId: ctx.threadId,
      topicId: ctx.topicId,
    });
    if (messagesKey !== representableBucketKey) return;

    // A concrete canonical key creates the cache entry even when no subscriber
    // has mounted yet, which lets a later conversation switch render locally.
    void mutate(messageListKey(ctx), messages, { revalidate: false });
  };

  useFetchMessages = (
    context: ConversationContext,
    options?: {
      /**
       * Skip the fetch entirely (e.g. while another flow owns the data).
       * Equivalent to passing a null SWR key.
       */
      skipFetch?: boolean;
      /**
       * Revalidate when the window regains focus. Defaults to SWR's
       * client-data default (true). Pass `false` to suppress the focus
       * refetch — used during streaming so the in-memory stream payload
       * (Source of Truth) isn't clobbered by a stale DB read while DB
       * fan-out writes are still in flight.
       */
      revalidateOnFocus?: boolean;
    },
  ): SWRResponse<UIChatMessage[]> => {
    const { skipFetch, revalidateOnFocus } = options ?? {};

    // Skip fetch when skipFetch is true or required fields are missing
    const shouldFetch = !skipFetch && !!context.agentId && !!context.topicId;

    return useClientDataSWRWithSync<UIChatMessage[]>(
      shouldFetch ? messageListKey(context) : null,
      () => runMessageListQuery(context, messageService.getMessages),
      {
        ...getMessageListFetchPolicy(context),
        onData: (data) => {
          if (!data || !context.topicId) return;

          // Use replaceMessages to store the fetched messages
          this.#get().replaceMessages(data, { action: 'useFetchMessages', context });
        },
        ...(revalidateOnFocus !== undefined && { revalidateOnFocus }),
      },
    );
  };
}

export type MessageQueryAction = Pick<MessageQueryActionImpl, keyof MessageQueryActionImpl>;
