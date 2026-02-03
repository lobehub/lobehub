/* eslint-disable sort-keys-fix/sort-keys-fix, typescript-sort-keys/interface */
import {
  type ChatMessageError,
  type ChatMessagePluginError,
  type ChatToolPayload,
  type MessagePluginItem,
} from '@lobechat/types';
import isEqual from 'fast-deep-equal';

import { messageService } from '@/services/message';
import { type OptimisticUpdateContext } from '@/store/chat/slices/message/actions/optimisticUpdate';
import { type ChatStore } from '@/store/chat/store';
import { type StoreSetter } from '@/store/types';
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

type Setter = StoreSetter<ChatStore>;
export const pluginOptimisticUpdate = (set: Setter, get: () => ChatStore, _api?: unknown) =>
  new PluginOptimisticUpdateActionImpl(set, get, _api);

export class PluginOptimisticUpdateActionImpl {
  readonly #get: () => ChatStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => ChatStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  optimisticUpdatePluginState = async (
    id: string,
    value: any,
    context?: OptimisticUpdateContext,
  ): Promise<void> => {
    const { replaceMessages, internal_getConversationContext } = this.#get();

    // optimistic update
    this.#get().internal_dispatchMessage(
      { id, type: 'updateMessage', value: { pluginState: value } },
      context,
    );

    const ctx = internal_getConversationContext(context);
    const result = await messageService.updateMessagePluginState(id, value, ctx);

    if (result?.success && result.messages) {
      replaceMessages(result.messages, { context: ctx });
    }
  };

  optimisticUpdatePluginArguments = async <T = any>(
    id: string,
    value: T,
    replace = false,
    context?: OptimisticUpdateContext,
  ): Promise<void> => {
    const { refreshMessages } = this.#get();
    const toolMessage = displayMessageSelectors.getDisplayMessageById(id)(this.#get());
    if (!toolMessage || !toolMessage?.tool_call_id) return;

    let assistantMessage = displayMessageSelectors.getDisplayMessageById(
      toolMessage?.parentId || '',
    )(this.#get());

    const prevArguments = toolMessage?.plugin?.arguments;
    const prevJson = safeParseJSON(prevArguments || '');
    const nextValue = replace ? (value as any) : merge(prevJson || {}, value);
    if (isEqual(prevJson, nextValue)) return;

    // optimistic update
    this.#get().internal_dispatchMessage(
      { id, type: 'updateMessagePlugin', value: { arguments: JSON.stringify(nextValue) } },
      context,
    );

    // 同样需要更新 assistantMessage 的 pluginArguments
    if (assistantMessage) {
      this.#get().internal_dispatchMessage(
        {
          id: assistantMessage.id,
          type: 'updateMessageTools',
          tool_call_id: toolMessage?.tool_call_id,
          value: { arguments: JSON.stringify(nextValue) },
        },
        context,
      );
      assistantMessage = displayMessageSelectors.getDisplayMessageById(assistantMessage?.id)(
        this.#get(),
      );
    }

    const updateAssistantMessage = async () => {
      if (!assistantMessage) return;
      await messageService.updateMessage(assistantMessage.id, {
        tools: assistantMessage?.tools,
      });
    };

    await Promise.all([
      messageService.updateMessagePluginArguments(id, nextValue),
      updateAssistantMessage(),
    ]);

    await refreshMessages();
  };

  optimisticUpdatePlugin = async (
    id: string,
    value: Partial<MessagePluginItem>,
    context?: OptimisticUpdateContext,
  ): Promise<void> => {
    const { replaceMessages, internal_getConversationContext } = this.#get();

    // optimistic update
    this.#get().internal_dispatchMessage(
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
  };

  optimisticAddToolToAssistantMessage = async (
    id: string,
    tool: ChatToolPayload,
    context?: OptimisticUpdateContext,
  ): Promise<void> => {
    const assistantMessage = displayMessageSelectors.getDisplayMessageById(id)(this.#get());
    if (!assistantMessage) return;

    const { internal_dispatchMessage, internal_refreshToUpdateMessageTools } = this.#get();
    internal_dispatchMessage(
      {
        type: 'addMessageTool',
        value: tool,
        id: assistantMessage.id,
      },
      context,
    );

    await internal_refreshToUpdateMessageTools(id, context);
  };

  optimisticRemoveToolFromAssistantMessage = async (
    id: string,
    tool_call_id?: string,
    context?: OptimisticUpdateContext,
  ): Promise<void> => {
    const message = displayMessageSelectors.getDisplayMessageById(id)(this.#get());
    if (!message || !tool_call_id) return;

    const { internal_dispatchMessage, internal_refreshToUpdateMessageTools } = this.#get();

    // optimistic update
    internal_dispatchMessage({ type: 'deleteMessageTool', tool_call_id, id: message.id }, context);

    // update the message tools
    await internal_refreshToUpdateMessageTools(id, context);
  };

  optimisticUpdatePluginError = async (
    id: string,
    error: ChatMessageError,
    context?: OptimisticUpdateContext,
  ): Promise<void> => {
    const { replaceMessages, internal_getConversationContext } = this.#get();

    this.#get().internal_dispatchMessage({ id, type: 'updateMessage', value: { error } }, context);

    const ctx = internal_getConversationContext(context);
    const result = await messageService.updateMessage(id, { error }, ctx);
    if (result?.success && result.messages) {
      replaceMessages(result.messages, { context: ctx });
    }
  };

  internal_refreshToUpdateMessageTools = async (
    id: string,
    context?: OptimisticUpdateContext,
  ): Promise<void> => {
    const { dbMessageSelectors } = await import('../../message/selectors');
    const message = dbMessageSelectors.getDbMessageById(id)(this.#get());
    if (!message || !message.tools) return;

    const { internal_toggleMessageLoading, replaceMessages, internal_getConversationContext } =
      this.#get();

    const ctx = internal_getConversationContext(context);

    internal_toggleMessageLoading(true, id);
    const result = await messageService.updateMessage(id, { tools: message.tools }, ctx);
    internal_toggleMessageLoading(false, id);

    if (result?.success && result.messages) {
      replaceMessages(result.messages, { context: ctx });
    }
  };

  optimisticUpdateToolMessage = async (
    id: string,
    params: UpdateToolMessageParams,
    context?: OptimisticUpdateContext,
  ): Promise<void> => {
    const { replaceMessages, internal_getConversationContext, internal_dispatchMessage } =
      this.#get();

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
  };
}

export type PluginOptimisticUpdateAction = Pick<
  PluginOptimisticUpdateActionImpl,
  keyof PluginOptimisticUpdateActionImpl
>;
