import {
  type ChatImageItem,
  type ChatMessageError,
  type ChatMessagePluginError,
  type ChatToolPayload,
  type CreateMessageParams,
  type GroundingSearch,
  type MessageMetadata,
  type MessagePluginItem,
  type ModelReasoning,
  type UIChatMessage,
  type UpdateMessageRAGParams,
} from '@lobechat/types';
import { ChatErrorType } from '@lobechat/types';
import { nanoid } from '@lobechat/utils';

import { messageService } from '@/services/message';
import { type ChatStore } from '@/store/chat/store';
import { type StoreSetter } from '@/store/types';

/**
 * Context for optimistic updates to specify session/topic isolation
 */
export interface OptimisticUpdateContext {
  operationId?: string;
  /** Pre-generated temp message ID (used when ID needs to be known before creation) */
  tempMessageId?: string;
}

/**
 * Optimistic update operations
 * All methods follow the pattern: update frontend first, then persist to database
 */

type Setter = StoreSetter<ChatStore>;
export const messageOptimisticUpdate = (set: Setter, get: () => ChatStore, _api?: unknown) =>
  new MessageOptimisticUpdateActionImpl(set, get, _api);

export class MessageOptimisticUpdateActionImpl {
  readonly #get: () => ChatStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => ChatStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  optimisticCreateMessage = async (
    message: CreateMessageParams,
    context?: {
      groupMessageId?: string;
      operationId?: string;
      tempMessageId?: string;
    },
  ): Promise<{ id: string; messages: UIChatMessage[] } | undefined> => {
    const {
      optimisticCreateTmpMessage,
      internal_toggleMessageLoading,
      internal_dispatchMessage,
      replaceMessages,
    } = this.#get();

    let tempId = context?.tempMessageId;
    if (!tempId) {
      tempId = optimisticCreateTmpMessage(message as any, context);
      internal_toggleMessageLoading(true, tempId);
    }

    try {
      const result = await messageService.createMessage(message);

      // Use the messages returned from createMessage (already grouped)
      const ctx = this.#get().internal_getConversationContext(context);
      replaceMessages(result.messages, { context: ctx });

      internal_toggleMessageLoading(false, tempId);
      return result;
    } catch (e) {
      internal_toggleMessageLoading(false, tempId);
      internal_dispatchMessage(
        {
          id: tempId,
          type: 'updateMessage',
          value: {
            error: {
              body: e,
              message: (e as Error).message,
              type: ChatErrorType.CreateMessageError,
            },
          },
        },
        context,
      );
    }
  };

  optimisticCreateTmpMessage = (
    message: CreateMessageParams,
    context?: OptimisticUpdateContext,
  ): string => {
    const { internal_dispatchMessage } = this.#get();

    // use optimistic update to avoid the slow waiting
    // use pre-generated tempMessageId if provided, otherwise generate a new one
    const tempId = context?.tempMessageId || 'tmp_' + nanoid();
    internal_dispatchMessage({ id: tempId, type: 'createMessage', value: message }, context);

    return tempId;
  };

  optimisticDeleteMessage = async (
    id: string,
    context?: OptimisticUpdateContext,
  ): Promise<void> => {
    this.#get().internal_dispatchMessage({ id, type: 'deleteMessage' }, context);
    const ctx = this.#get().internal_getConversationContext(context);
    const result = await messageService.removeMessage(id, ctx);
    if (result?.success && result.messages) {
      this.#get().replaceMessages(result.messages, { context: ctx });
    }
  };

  optimisticDeleteMessages = async (
    ids: string[],
    context?: OptimisticUpdateContext,
  ): Promise<void> => {
    this.#get().internal_dispatchMessage({ ids, type: 'deleteMessages' }, context);
    const ctx = this.#get().internal_getConversationContext(context);
    const result = await messageService.removeMessages(ids, ctx);
    if (result?.success && result.messages) {
      this.#get().replaceMessages(result.messages, { context: ctx });
    }
  };

  optimisticUpdateMessageContent = async (
    id: string,
    content: string,
    extra?: {
      imageList?: ChatImageItem[];
      metadata?: MessageMetadata;
      model?: string;
      provider?: string;
      reasoning?: ModelReasoning;
      search?: GroundingSearch;
      tools?: ChatToolPayload[];
    },
    context?: OptimisticUpdateContext,
  ): Promise<void> => {
    const { internal_dispatchMessage, refreshMessages, replaceMessages } = this.#get();

    // Due to the async update method and refresh need about 100ms
    // we need to update the message content at the frontend to avoid the update flick
    // refs: https://medium.com/@kyledeguzmanx/what-are-optimistic-updates-483662c3e171
    if (extra?.tools) {
      internal_dispatchMessage(
        {
          id,
          type: 'updateMessage',
          value: { tools: extra?.tools },
        },
        context,
      );
    } else {
      internal_dispatchMessage(
        {
          id,
          type: 'updateMessage',
          value: { content, metadata: extra?.metadata },
        },
        context,
      );
    }

    const ctx = this.#get().internal_getConversationContext(context);

    const result = await messageService.updateMessage(
      id,
      {
        content,
        imageList: extra?.imageList,
        metadata: extra?.metadata,
        model: extra?.model,
        provider: extra?.provider,
        reasoning: extra?.reasoning,
        search: extra?.search,
        tools: extra?.tools,
      },
      ctx,
    );

    if (result && result.success && result.messages) {
      replaceMessages(result.messages, { action: 'optimisticUpdateMessageContent', context: ctx });
    } else {
      await refreshMessages();
    }
  };

  optimisticUpdateMessageError = async (
    id: string,
    error: ChatMessageError | null,
    context?: OptimisticUpdateContext,
  ): Promise<void> => {
    this.#get().internal_dispatchMessage({ id, type: 'updateMessage', value: { error } }, context);
    const ctx = this.#get().internal_getConversationContext(context);
    const result = await messageService.updateMessage(id, { error }, ctx);
    if (result?.success && result.messages) {
      this.#get().replaceMessages(result.messages, { context: ctx });
    } else {
      await this.#get().refreshMessages();
    }
  };

  optimisticUpdateMessageMetadata = async (
    id: string,
    metadata: Partial<MessageMetadata>,
    context?: OptimisticUpdateContext,
  ): Promise<void> => {
    const { internal_dispatchMessage, refreshMessages, replaceMessages } = this.#get();

    internal_dispatchMessage({ id, type: 'updateMessageMetadata', value: metadata }, context);

    const ctx = this.#get().internal_getConversationContext(context);
    const result = await messageService.updateMessageMetadata(id, metadata, ctx);

    if (result?.success && result.messages) {
      replaceMessages(result.messages, { context: ctx });
    } else {
      await refreshMessages();
    }
  };

  optimisticUpdateMessagePlugin = async (
    id: string,
    value: Partial<MessagePluginItem>,
    context?: OptimisticUpdateContext,
  ): Promise<void> => {
    const { internal_dispatchMessage, replaceMessages } = this.#get();

    internal_dispatchMessage({ id, type: 'updateMessagePlugin', value }, context);

    const ctx = this.#get().internal_getConversationContext(context);
    const result = await messageService.updateMessagePlugin(id, value, ctx);

    if (result?.success && result.messages) {
      replaceMessages(result.messages, { context: ctx });
    }
  };

  optimisticUpdateMessagePluginError = async (
    id: string,
    error: ChatMessagePluginError | null,
    context?: OptimisticUpdateContext,
  ): Promise<void> => {
    const ctx = this.#get().internal_getConversationContext(context);
    const result = await messageService.updateMessagePluginError(id, error, ctx);
    if (result?.success && result.messages) {
      this.#get().replaceMessages(result.messages, { context: ctx });
    }
  };

  optimisticUpdateMessageRAG = async (
    id: string,
    data: UpdateMessageRAGParams,
    context?: OptimisticUpdateContext,
  ): Promise<void> => {
    const ctx = this.#get().internal_getConversationContext(context);
    const result = await messageService.updateMessageRAG(id, data, ctx);
    if (result?.success && result.messages) {
      this.#get().replaceMessages(result.messages, { context: ctx });
    }
  };
}

export type MessageOptimisticUpdateAction = Pick<
  MessageOptimisticUpdateActionImpl,
  keyof MessageOptimisticUpdateActionImpl
>;
