/* eslint-disable sort-keys-fix/sort-keys-fix, typescript-sort-keys/interface */
import {
  type ChatMessageError,
  type ChatMessagePluginError,
  type ChatToolPayload,
  type MessagePluginItem,
} from '@lobechat/types';
import isEqual from 'fast-deep-equal';
import { type StateCreator } from 'zustand/vanilla';

import { messageService } from '@/services/message';
import { type OptimisticUpdateContext } from '@/store/chat/slices/message/actions/optimisticUpdate';
import { type ChatStore } from '@/store/chat/store';
import { merge } from '@/utils/merge';
import { safeParseJSON } from '@/utils/safeParseJSON';

import { displayMessageSelectors } from '../../message/selectors';

/**
 * Params for batch updating tool message content, state, and error
 */
export interface UpdateToolMessageParams {
  content?: string;
  /**
   * Metadata to attach to the tool message
   * Used to mark messages for special handling (e.g., agentCouncil for parallel display)
   */
  metadata?: Record<string, any>;
  pluginError?: ChatMessagePluginError | null;
  pluginState?: any;
}

/**
 * Optimistic update operations for plugin-related data
 * All methods follow the pattern: update frontend first, then persist to database
 */
export interface PluginOptimisticUpdateAction {
  /**
   * Update plugin state with optimistic update
   */
  optimisticUpdatePluginState: (
    id: string,
    value: any,
    context?: OptimisticUpdateContext,
  ) => Promise<void>;

  /**
   * Update plugin arguments with optimistic update
   */
  optimisticUpdatePluginArguments: <T = any>(
    id: string,
    value: T,
    replace?: boolean,
    context?: OptimisticUpdateContext,
  ) => Promise<void>;

  /**
   * Update plugin with optimistic update (generic method for any plugin field)
   */
  optimisticUpdatePlugin: (
    id: string,
    value: Partial<MessagePluginItem>,
    context?: OptimisticUpdateContext,
  ) => Promise<void>;

  /**
   * Add tool to assistant message with optimistic update
   */
  optimisticAddToolToAssistantMessage: (
    id: string,
    tool: ChatToolPayload,
    context?: OptimisticUpdateContext,
  ) => Promise<void>;

  /**
   * Remove tool from assistant message with optimistic update
   */
  optimisticRemoveToolFromAssistantMessage: (
    id: string,
    tool_call_id?: string,
    context?: OptimisticUpdateContext,
  ) => Promise<void>;

  /**
   * Update plugin error with optimistic update
   */
  optimisticUpdatePluginError: (
    id: string,
    error: ChatMessageError,
    context?: OptimisticUpdateContext,
  ) => Promise<void>;

  /**
   * Use the optimistic update value to update the message tools to database
   */
  internal_refreshToUpdateMessageTools: (
    id: string,
    context?: OptimisticUpdateContext,
  ) => Promise<void>;

  /**
   * Batch update tool message content, state, and error in a single call
   * This is optimized for builtin tool executors to reduce multiple update calls
   */
  optimisticUpdateToolMessage: (
    id: string,
    params: UpdateToolMessageParams,
    context?: OptimisticUpdateContext,
  ) => Promise<void>;
}

export const pluginOptimisticUpdate: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  PluginOptimisticUpdateAction
> = (set, get) => ({
  optimisticUpdatePluginState: async (id, value, context) => {
    const { replaceMessages, internal_getConversationContext } = get();

    // optimistic update
    get().internal_dispatchMessage(
      { id, type: 'updateMessage', value: { pluginState: value } },
      context,
    );

    const ctx = internal_getConversationContext(context);
    const result = await messageService.updateMessagePluginState(id, value, ctx);

    if (result?.success && result.messages) {
      replaceMessages(result.messages, { context: ctx });
    }
  },

  optimisticUpdatePluginArguments: async (id, value, replace = false, context) => {
    const { refreshMessages } = get();
    const toolMessage = displayMessageSelectors.getDisplayMessageById(id)(get());
    if (!toolMessage || !toolMessage?.tool_call_id) return;

    let assistantMessage = displayMessageSelectors.getDisplayMessageById(
      toolMessage?.parentId || '',
    )(get());

    const prevArguments = toolMessage?.plugin?.arguments;
    const prevJson = safeParseJSON(prevArguments || '');
    const nextValue = replace ? (value as any) : merge(prevJson || {}, value);
    if (isEqual(prevJson, nextValue)) return;

    // optimistic update
    get().internal_dispatchMessage(
      { id, type: 'updateMessagePlugin', value: { arguments: JSON.stringify(nextValue) } },
      context,
    );

    // 同样需要更新 assistantMessage 的 pluginArguments
    if (assistantMessage) {
      get().internal_dispatchMessage(
        {
          id: assistantMessage.id,
          type: 'updateMessageTools',
          tool_call_id: toolMessage?.tool_call_id,
          value: { arguments: JSON.stringify(nextValue) },
        },
        context,
      );
      assistantMessage = displayMessageSelectors.getDisplayMessageById(assistantMessage?.id)(get());
    }

    const updateAssistantMessage = async () => {
      if (!assistantMessage) return;
      await messageService.updateMessage(assistantMessage!.id, {
        tools: assistantMessage?.tools,
      });
    };

    await Promise.all([
      messageService.updateMessagePluginArguments(id, nextValue),
      updateAssistantMessage(),
    ]);

    await refreshMessages();
  },

  optimisticUpdatePlugin: async (id, value, context) => {
    const { replaceMessages, internal_getConversationContext } = get();

    // optimistic update
    get().internal_dispatchMessage(
      {
        id,
        type: 'updateMessagePlugin',
        value,
      },
      context,
    );

    const ctx = internal_getConversationContext(context);
    const result = await messageService.updateMessagePlugin(id, value, ctx);

    if (result?.success && result.messages) {
      replaceMessages(result.messages, { context: ctx });
    }
  },

  optimisticAddToolToAssistantMessage: async (id, tool, context) => {
    const assistantMessage = displayMessageSelectors.getDisplayMessageById(id)(get());
    if (!assistantMessage) return;

    const { internal_dispatchMessage, internal_refreshToUpdateMessageTools } = get();
    internal_dispatchMessage(
      {
        type: 'addMessageTool',
        value: tool,
        id: assistantMessage.id,
      },
      context,
    );

    await internal_refreshToUpdateMessageTools(id, context);
  },

  optimisticRemoveToolFromAssistantMessage: async (id, tool_call_id, context) => {
    const message = displayMessageSelectors.getDisplayMessageById(id)(get());
    if (!message || !tool_call_id) return;

    const { internal_dispatchMessage, internal_refreshToUpdateMessageTools } = get();

    // optimistic update
    internal_dispatchMessage({ type: 'deleteMessageTool', tool_call_id, id: message.id }, context);

    // update the message tools
    await internal_refreshToUpdateMessageTools(id, context);
  },

  optimisticUpdatePluginError: async (id, error, context) => {
    const { replaceMessages, internal_getConversationContext } = get();

    get().internal_dispatchMessage({ id, type: 'updateMessage', value: { error } }, context);

    const ctx = internal_getConversationContext(context);
    const result = await messageService.updateMessage(id, { error }, ctx);
    if (result?.success && result.messages) {
      replaceMessages(result.messages, { context: ctx });
    }
  },

  internal_refreshToUpdateMessageTools: async (id, context) => {
    const { dbMessageSelectors } = await import('../../message/selectors');
    const message = dbMessageSelectors.getDbMessageById(id)(get());
    if (!message || !message.tools) return;

    const { internal_toggleMessageLoading, replaceMessages, internal_getConversationContext } =
      get();

    const ctx = internal_getConversationContext(context);

    internal_toggleMessageLoading(true, id);
    const result = await messageService.updateMessage(id, { tools: message.tools }, ctx);
    internal_toggleMessageLoading(false, id);

    if (result?.success && result.messages) {
      replaceMessages(result.messages, { context: ctx });
    }
  },

  optimisticUpdateToolMessage: async (id, params, context) => {
    const { replaceMessages, internal_getConversationContext, internal_dispatchMessage } = get();

    const { content, metadata, pluginState, pluginError } = params;

    // Batch optimistic updates - update frontend immediately
    internal_dispatchMessage(
      { id, type: 'updateMessage', value: { pluginState, content, metadata } },
      context,
    );

    if (pluginError !== undefined) {
      internal_dispatchMessage(
        { id, type: 'updateMessagePlugin', value: { error: pluginError } },
        context,
      );
    }

    const ctx = internal_getConversationContext(context);

    // Use single API call to update all fields in one transaction
    // This prevents race conditions that occurred with multiple parallel requests
    const result = await messageService.updateToolMessage(
      id,
      { content, metadata, pluginError, pluginState },
      ctx,
    );

    if (result?.success && result.messages) {
      replaceMessages(result.messages, { context: ctx });
    }
  },
});
