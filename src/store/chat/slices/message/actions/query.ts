import { parse } from '@lobechat/conversation-flow';
import { type ConversationContext, type UIChatMessage } from '@lobechat/types';
import isEqual from 'fast-deep-equal';
import { type SWRResponse } from 'swr';

import { mutate, useClientDataSWRWithSync } from '@/libs/swr';
import { messageService } from '@/services/message';
import { type ChatStore } from '@/store/chat/store';
import { type StoreSetter } from '@/store/types';

import { type MessageMapKeyInput } from '../../../utils/messageMapKey';
import { messageMapKey } from '../../../utils/messageMapKey';
import { reconcileAssistantToolLinks } from '../utils/reconcileTools';

const SWR_USE_FETCH_MESSAGES = 'SWR_USE_FETCH_MESSAGES';

/**
 * Data query and synchronization actions
 * Handles fetching, refreshing, and replacing message data
 */

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

  refreshMessages = async (context?: Partial<ConversationContext>): Promise<void> => {
    const agentId = context?.agentId ?? this.#get().activeAgentId;
    const topicId = context?.topicId !== undefined ? context.topicId : this.#get().activeTopicId;
    // TODO: Support threadId refresh when needed
    await mutate([SWR_USE_FETCH_MESSAGES, agentId, topicId, 'session']);
    await mutate([SWR_USE_FETCH_MESSAGES, agentId, topicId, 'group']);
  };

  replaceMessages = (
    messages: UIChatMessage[],
    params?: {
      action?: any;

      context?: Partial<ConversationContext>;

      operationId?: string;
    },
  ): void => {
    let ctx: MessageMapKeyInput;

    // Priority 1: Use explicit context if provided (preserving scope)
    if (params?.context) {
      ctx = {
        agentId: params.context.agentId ?? this.#get().activeAgentId,
        // Preserve groupId from context
        groupId: params.context.groupId,
        // Preserve scope from context
        isNew: params.context.isNew,

        scope: params.context.scope,

        threadId: params.context.threadId,
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

    // Re-link any tool row whose parent assistant lost its tools[] entry before
    // it lands in the raw bucket — a stale / out-of-order snapshot can drop the
    // link while the tool row survives, which would orphan the tool bubble (see
    // reconcileAssistantToolLinks). Keeps dbMessagesMap (SoT) consistent for
    // optimistic updates, not just the parsed display.
    const reconciled = reconcileAssistantToolLinks(messages);

    // Get raw messages from dbMessagesMap and apply reducer
    const nextDbMap = { ...this.#get().dbMessagesMap, [messagesKey]: reconciled };

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
      shouldFetch ? ['CHAT_STORE_FETCH_MESSAGES', context] : null,
      () => messageService.getMessages(context),
      {
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
