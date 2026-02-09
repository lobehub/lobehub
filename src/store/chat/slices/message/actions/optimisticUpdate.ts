import {
  ChatErrorType,
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
import { nanoid } from '@lobechat/utils';
import { type StateCreator } from 'zustand/vanilla';

import { messageService } from '@/services/message';
import { type ChatStore } from '@/store/chat/store';

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
export interface MessageOptimisticUpdateAction {
  /**
   * create a message with optimistic update
   * returns the created message ID and updated message list
   */
  optimisticCreateMessage: (
    params: CreateMessageParams,
    context?: {
      groupMessageId?: string;
      operationId?: string;
      tempMessageId?: string;
    },
  ) => Promise<{ id: string; messages: UIChatMessage[] } | undefined>;

  /**
   * create a temp message for optimistic update
   * otherwise the message will be too slow to show
   */
  optimisticCreateTmpMessage: (
    params: CreateMessageParams,
    context?: OptimisticUpdateContext,
  ) => string;

  /**
   * delete the message content with optimistic update
   */
  optimisticDeleteMessage: (id: string, context?: OptimisticUpdateContext) => Promise<void>;
  optimisticDeleteMessages: (ids: string[], context?: OptimisticUpdateContext) => Promise<void>;

  /**
   * update the message content with optimistic update
   * a method used by other action
   */
  optimisticUpdateMessageContent: (
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
  ) => Promise<void>;

  /**
   * update the message error with optimistic update
   */
  optimisticUpdateMessageError: (
    id: string,
    error: ChatMessageError | null,
    context?: OptimisticUpdateContext,
  ) => Promise<void>;

  /**
   * update the message metadata with optimistic update
   */
  optimisticUpdateMessageMetadata: (
    id: string,
    metadata: Partial<MessageMetadata>,
    context?: OptimisticUpdateContext,
  ) => Promise<void>;

  /**
   * Optimistic update for message pluginIntervention field (frontend only, no database persistence)
   * Use this when you need to update plugin intervention status
   */
  optimisticUpdateMessagePlugin: (
    id: string,
    value: Partial<MessagePluginItem>,
    context?: OptimisticUpdateContext,
  ) => Promise<void>;

  /**
   * update the message plugin error with optimistic update
   */
  optimisticUpdateMessagePluginError: (
    id: string,
    error: ChatMessagePluginError | null,
    context?: OptimisticUpdateContext,
  ) => Promise<void>;

  /**
   * update message RAG with optimistic update
   */
  optimisticUpdateMessageRAG: (
    id: string,
    input: UpdateMessageRAGParams,
    context?: OptimisticUpdateContext,
  ) => Promise<void>;
}

export const messageOptimisticUpdate: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  MessageOptimisticUpdateAction
> = (set, get) => ({
  optimisticCreateMessage: async (message, context) => {
    const {
      optimisticCreateTmpMessage,
      internal_toggleMessageLoading,
      internal_dispatchMessage,
      replaceMessages,
    } = get();

    let tempId = context?.tempMessageId;
    if (!tempId) {
      tempId = optimisticCreateTmpMessage(message as any, context);
      internal_toggleMessageLoading(true, tempId);
    }

    try {
      const result = await messageService.createMessage(message);

      // Use the messages returned from createMessage (already grouped)
      const ctx = get().internal_getConversationContext(context);
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
  },

  optimisticCreateTmpMessage: (message, context) => {
    const { internal_dispatchMessage } = get();

    // use optimistic update to avoid the slow waiting
    // use pre-generated tempMessageId if provided, otherwise generate a new one
    const tempId = context?.tempMessageId || 'tmp_' + nanoid();
    internal_dispatchMessage({ id: tempId, type: 'createMessage', value: message }, context);

    return tempId;
  },

  optimisticDeleteMessage: async (id: string, context) => {
    get().internal_dispatchMessage({ id, type: 'deleteMessage' }, context);
    const ctx = get().internal_getConversationContext(context);
    const result = await messageService.removeMessage(id, ctx);
    if (result?.success && result.messages) {
      get().replaceMessages(result.messages, { context: ctx });
    }
  },

  optimisticDeleteMessages: async (ids, context) => {
    get().internal_dispatchMessage({ ids, type: 'deleteMessages' }, context);
    const ctx = get().internal_getConversationContext(context);
    const result = await messageService.removeMessages(ids, ctx);
    if (result?.success && result.messages) {
      get().replaceMessages(result.messages, { context: ctx });
    }
  },

  optimisticUpdateMessageContent: async (id, content, extra, context) => {
    const { internal_dispatchMessage, refreshMessages, replaceMessages } = get();

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

    const ctx = get().internal_getConversationContext(context);

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
  },

  optimisticUpdateMessageError: async (id, error, context) => {
    get().internal_dispatchMessage({ id, type: 'updateMessage', value: { error } }, context);
    const ctx = get().internal_getConversationContext(context);
    const result = await messageService.updateMessage(id, { error }, ctx);
    if (result?.success && result.messages) {
      get().replaceMessages(result.messages, { context: ctx });
    } else {
      await get().refreshMessages();
    }
  },

  optimisticUpdateMessageMetadata: async (id, metadata, context) => {
    const { internal_dispatchMessage, refreshMessages, replaceMessages } = get();

    internal_dispatchMessage({ id, type: 'updateMessageMetadata', value: metadata }, context);

    const ctx = get().internal_getConversationContext(context);
    const result = await messageService.updateMessageMetadata(id, metadata, ctx);

    if (result?.success && result.messages) {
      replaceMessages(result.messages, { context: ctx });
    } else {
      await refreshMessages();
    }
  },

  optimisticUpdateMessagePlugin: async (id, value, context) => {
    const { internal_dispatchMessage, replaceMessages } = get();

    internal_dispatchMessage({ id, type: 'updateMessagePlugin', value }, context);

    const ctx = get().internal_getConversationContext(context);
    const result = await messageService.updateMessagePlugin(id, value, ctx);

    if (result?.success && result.messages) {
      replaceMessages(result.messages, { context: ctx });
    }
  },

  optimisticUpdateMessagePluginError: async (id, error, context) => {
    const ctx = get().internal_getConversationContext(context);
    const result = await messageService.updateMessagePluginError(id, error, ctx);
    if (result?.success && result.messages) {
      get().replaceMessages(result.messages, { context: ctx });
    }
  },

  optimisticUpdateMessageRAG: async (id, data, context) => {
    const ctx = get().internal_getConversationContext(context);
    const result = await messageService.updateMessageRAG(id, data, ctx);
    if (result?.success && result.messages) {
      get().replaceMessages(result.messages, { context: ctx });
    }
  },
});
