import { type ConversationContext, type UIChatMessage } from '@lobechat/types';
import debug from 'debug';
import isEqual from 'fast-deep-equal';

import { mutate } from '@/libs/swr';
import { isMessageListKey } from '@/libs/swr/keys';
import {
  invalidateMessageListClientState,
  isMessageListServerVerified,
} from '@/services/message/cache';
import { revalidateConversationMessages } from '@/services/message/replica';
import {
  PREFETCH_BATCH_SIZE,
  primeMessageListPage,
  readMessagesByRoundCursorBatch,
  releaseUnusedPrimedMessageListPage,
} from '@/services/message/roundCursorPage';
import { operationSelectors } from '@/store/chat/slices/operation/selectors';
import { type ChatStore } from '@/store/chat/store';
import {
  isLocalOnlyMessage,
  mergeLocalMessagesByCreatedAt,
} from '@/store/chat/utils/localMessages';
import { type StoreSetter } from '@/store/types';

import { type MessageMapKeyInput } from '../../../utils/messageMapKey';
import { messageMapKey } from '../../../utils/messageMapKey';
import { getMessageTranscript } from '../transcript';
import { reconcileAssistantToolLinks } from '../utils/reconcileTools';

/**
 * Data query and synchronization actions
 * Handles fetching, refreshing, and replacing message data
 */

const log = debug('lobe-client:message-query');

/**
 * Topics one visible-row prefetch pass may warm. A viewport renders far fewer
 * rows than this; the cap only stops a long list or a fast scroll from turning
 * one paint into an unbounded fan-out.
 */
const MAX_PREFETCH_TOPICS_PER_CALL = 24;

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

    // A client-minted topic with no server row yet (first-send window): a
    // revalidation would return an empty list and wipe the optimistic messages.
    if (topicId && this.#get().creatingTopicIds.includes(topicId)) return;

    // Topic navigation is a soft ensure: a completed prefetch is already the
    // server snapshot the destination hook needs, while an in-flight prefetch
    // will be shared by the coordinator when the hook mounts.
    if (isMessageListServerVerified({ agentId, groupId, threadId, topicId })) return;

    const transcript = getMessageTranscript(this.#set, this.#get);
    await transcript.slice.revalidate(transcript.keyOf({ agentId, groupId, threadId, topicId }));
  };

  refreshMessages = async (context?: Partial<ConversationContext>): Promise<void> => {
    const agentId = context?.agentId ?? this.#get().activeAgentId;
    const topicId = context?.topicId !== undefined ? context.topicId : this.#get().activeTopicId;

    // A force refresh owns both invalidation layers. Do this synchronously
    // before the revalidation so an inactive entry with no subscriber still
    // loses its verification window and any older in-flight generation.
    invalidateMessageListClientState((ctx) => ctx.agentId === agentId && ctx.topicId === topicId);

    // Revalidate every transcript sync of this agent+topic (any scope / thread
    // / share variant).
    await revalidateConversationMessages(
      (ctx) => ctx.agentId === agentId && ctx.topicId === topicId,
    );
  };

  /**
   * Drop the transcripts of deleted conversations from memory and storage
   * (every one when `predicate` is omitted). Nothing is refetched: the
   * conversation is gone.
   *
   * Installs upgraded from before the replica still hold `message:list` rows
   * in the SWR IndexedDB tier, which never expires them; those are purged too
   * until the SWR persistence layer is removed.
   */
  evictConversationMessages = async (
    predicate?: (context: ConversationContext) => boolean,
  ): Promise<void> => {
    await Promise.all([
      getMessageTranscript(this.#set, this.#get).evict(predicate),
      mutate((key) => isMessageListKey(key, predicate), undefined, { revalidate: false }),
    ]);
  };

  prefetchMessages = async (context: ConversationContext): Promise<void> => {
    if (!context.agentId || !context.topicId) return;
    // A client-minted topic with no server row yet (first-send window) would
    // prefetch an empty list and clobber the optimistic messages on screen.
    if (this.#get().creatingTopicIds.includes(context.topicId)) return;
    if (operationSelectors.isAgentRuntimeRunningByContext(context)(this.#get())) return;
    if (isMessageListServerVerified(context)) return;

    // The transcript's own head read: it joins a sync already in flight, and a
    // send landing while it is out keeps its rows (see the head merge).
    try {
      await getMessageTranscript(this.#set, this.#get).slice.fetch(context);
    } catch (error) {
      // Background warming should never surface an unhandled rejection.
      log('Failed to warm the message transcript: %O', error);
    }
  };

  /**
   * Batched form of {@link prefetchMessages} for a list surface: every visible
   * topic the caller hands over is warmed from ONE server read.
   *
   * Each topic still goes through its own transcript head path — same merge,
   * cursor and persistence — because the batch only hands over the page
   * (`primeMessageListPage`); what changes is that N visible rows cost one
   * request. A page the batch did not return, or a failed batch, leaves that
   * topic on its normal read.
   *
   * Eligibility mirrors the single prefetch: no client-minted topic, nothing
   * running locally, and nothing the store can already paint.
   */
  prefetchTopicMessagesBatch = async (params: {
    agentId?: string | null;
    groupId?: string | null;
    topicIds: string[];
  }): Promise<void> => {
    const { agentId, topicIds } = params;
    if (!agentId || topicIds.length === 0) return;

    const chat = this.#get();
    const transcript = getMessageTranscript(this.#set, this.#get);

    const contexts = [...new Set(topicIds)]
      .filter((topicId) => !chat.creatingTopicIds.includes(topicId))
      // The active conversation loads through its own sync; warming it here
      // would race that read with the smaller prefetch window.
      .filter((topicId) => topicId !== chat.activeTopicId)
      .map((topicId) => ({
        agentId,
        groupId: params.groupId ?? undefined,
        scope: 'main' as const,
        threadId: null,
        topicId,
      }))
      .filter((context) => !operationSelectors.isAgentRuntimeRunningByContext(context)(chat))
      // "Visible and nothing local" is the whole point: a populated transcript
      // is already what the row would paint on click.
      .filter((context) => !transcript.read(transcript.keyOf(context))?.items.length)
      .slice(0, MAX_PREFETCH_TOPICS_PER_CALL);

    for (let index = 0; index < contexts.length; index += PREFETCH_BATCH_SIZE) {
      const chunk = contexts.slice(index, index + PREFETCH_BATCH_SIZE);
      const pages = readMessagesByRoundCursorBatch(chunk);

      const primed = chunk.map((context) => {
        const page = pages.then((result) => {
          const batched = result.get(context.topicId!);
          // A topic the batch skipped must not settle as an empty transcript.
          if (!batched) throw new Error(`No batch page for topic ${context.topicId}`);

          return batched;
        });
        primeMessageListPage(context, page);

        return { context, page };
      });

      await Promise.all(
        primed.map(async ({ context, page }) => {
          try {
            await transcript.slice.fetch(context);
          } catch (error) {
            log('Failed to warm the topic transcript %s: %O', context.topicId, error);
          }
          // This fetch joins a read already in flight when one is out, and a
          // joined read never takes the page primed here. Dropping the unused
          // prime keeps an old batch window from answering a later head read.
          releaseUnusedPrimedMessageListPage(context, page);
        }),
      );
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
      ctx = this.#get().internal_getConversationContext({ operationId: params.operationId });
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
    const persistedIncoming = incoming.filter((message) => !isLocalOnlyMessage(message));
    const persistedIds = new Set(persistedIncoming.map((message) => message.id));
    const currentMessages = this.#get().dbMessagesMap[messagesKey] ?? [];
    const voiceMessageUploadMap = this.#get().voiceMessageUploadMap;
    const activeLocalMessagesById = new Map<string, UIChatMessage>();

    // Server snapshots never contain the local voice placeholder. Keep it in the in-memory
    // transcript only while the owning upload transaction is still active. Consider both the
    // existing ChatStore bucket and the incoming ConversationStore snapshot: the latter can carry
    // the placeholder after another server replacement briefly removed it from ChatStore.
    for (const message of [...currentMessages, ...incoming]) {
      if (
        isLocalOnlyMessage(message) &&
        voiceMessageUploadMap[message.id] &&
        !persistedIds.has(message.id) &&
        !activeLocalMessagesById.has(message.id)
      ) {
        activeLocalMessagesById.set(message.id, message);
      }
    }

    const persistedReconciled = reconcileAssistantToolLinks(persistedIncoming);
    const reconciled = reconcileAssistantToolLinks(
      mergeLocalMessagesByCreatedAt(persistedReconciled, [...activeLocalMessagesById.values()]),
    );

    const transcript = getMessageTranscript(this.#set, this.#get);
    // The server returned these rows, so their optimistic mark is settled even
    // when the bucket already holds the same list (the commit below is skipped).
    transcript.confirmServerRows(persistedIncoming);
    // Rows this replacement removed or remapped (an optimistic `tmp_*` id
    // replaced by the server id) can never be preserved again; reads issued
    // before the remap keep protecting the rows that replaced them.
    const currentIds = new Set(currentMessages.map((message) => message.id));
    const nextIds = new Set(reconciled.map((message) => message.id));
    transcript.remapClientRows(
      [...currentIds].filter((id) => !nextIds.has(id)),
      persistedIncoming.map((message) => message.id).filter((id) => !currentIds.has(id)),
    );
    // An unchanged bucket still settles: an optimistic dispatch may already
    // have applied this exact state in memory while the stored copy is older.
    if (!isEqual(reconciled, currentMessages) || !this.#get().dbMessagesMap[messagesKey]) {
      log(
        '[replaceMessages] %s | key=%s | count=%d',
        params?.action,
        messagesKey,
        reconciled.length,
      );
      transcript.commit(ctx, reconciled);
    }
    transcript.settle(ctx);
  };
}

export type MessageQueryAction = Pick<MessageQueryActionImpl, keyof MessageQueryActionImpl>;
