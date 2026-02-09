/* eslint-disable sort-keys-fix/sort-keys-fix,typescript-sort-keys/interface */
import { TraceEventType } from '@lobechat/types';
import { copyToClipboard } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { type StateCreator } from 'zustand/vanilla';

import { messageService } from '@/services/message';
import { topicService } from '@/services/topic';
import { type ChatStore } from '@/store/chat/store';
import { setNamespace } from '@/utils/storeDebug';

import { dbMessageSelectors, displayMessageSelectors } from '../../../selectors';
import { toggleBooleanList } from '../../../utils';
import { type OptimisticUpdateContext } from './optimisticUpdate';

const n = setNamespace('m');

/**
 * Public API for components
 * These methods are directly called by UI components
 */
export interface MessagePublicApiAction {
  // ===== Create ===== //
  addAIMessage: () => Promise<void>;
  addUserMessage: (params: { message: string; fileList?: string[] }) => Promise<void>;

  // ===== Delete ===== //
  /**
   * clear message on the active session
   */
  clearMessage: () => Promise<void>;
  /**
   * Delete a message by id
   * @param id - message id
   * @param context - Optional context for optimistic update (required for Group mode)
   */
  deleteMessage: (id: string, context?: OptimisticUpdateContext) => Promise<void>;
  /**
   * Delete an assistant message and its associated tool messages
   * @param id - message id
   * @param context - Optional context for optimistic update (required for Group mode)
   */
  deleteAssistantMessage: (id: string, context?: OptimisticUpdateContext) => Promise<void>;
  deleteDBMessage: (id: string) => Promise<void>;
  deleteToolMessage: (id: string) => Promise<void>;
  clearAllMessages: () => Promise<void>;

  // ===== Update ===== //
  /**
   * Update message input box content
   */
  updateMessageInput: (message: string) => void;
  /**
   * Modify message content
   * @param id - message id
   * @param content - new content
   * @param context - Optional context for optimistic update (required for Group mode)
   */
  modifyMessageContent: (
    id: string,
    content: string,
    context?: OptimisticUpdateContext,
  ) => Promise<void>;
  toggleMessageEditing: (id: string, editing: boolean) => void;
  /**
   * Toggle message collapsed state
   * @param id - message id
   * @param collapsed - collapsed state, if not provided, toggle current state
   * @param context - Optional context for optimistic update (required for Group mode)
   */
  toggleMessageCollapsed: (
    id: string,
    collapsed?: boolean,
    context?: OptimisticUpdateContext,
  ) => Promise<void>;
  /**
   * Toggle tool inspect expanded state
   * @param id - message id
   * @param expanded - expanded state, if not provided, toggle current state
   * @param context - Optional context for optimistic update (required for Group mode)
   */
  toggleInspectExpanded: (
    id: string,
    expanded?: boolean,
    context?: OptimisticUpdateContext,
  ) => Promise<void>;

  // ===== Others ===== //
  copyMessage: (id: string, content: string) => Promise<void>;
}

export const messagePublicApi: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  MessagePublicApiAction
> = (set, get) => ({
  addAIMessage: async () => {
    const {
      optimisticCreateMessage,
      updateMessageInput,
      activeTopicId,
      activeAgentId,
      activeThreadId,
      activeGroupId,
      inputMessage,
    } = get();
    if (!activeAgentId) return;

    const parentId = displayMessageSelectors.lastDisplayMessageId(get());

    const result = await optimisticCreateMessage({
      content: inputMessage,
      role: 'assistant',
      agentId: activeAgentId,
      topicId: activeTopicId,
      threadId: activeThreadId,
      groupId: activeGroupId,
      parentId,
    });

    if (result) {
      updateMessageInput('');
    }
  },

  addUserMessage: async ({ message, fileList }) => {
    const {
      optimisticCreateMessage,
      updateMessageInput,
      activeTopicId,
      activeAgentId,
      activeThreadId,
      activeGroupId,
    } = get();
    if (!activeAgentId) return;

    const parentId = displayMessageSelectors.lastDisplayMessageId(get());

    const result = await optimisticCreateMessage({
      content: message,
      files: fileList,
      role: 'user',
      agentId: activeAgentId,
      topicId: activeTopicId,
      threadId: activeThreadId,
      groupId: activeGroupId,
      parentId,
    });

    if (result) {
      updateMessageInput('');
    }
  },

  deleteAssistantMessage: async (id, context) => {
    const message = dbMessageSelectors.getDbMessageById(id)(get());
    if (!message) return;

    let ids = [message.id];
    if (message.tools) {
      const allMessages = dbMessageSelectors.activeDbMessages(get());

      const toolMessageIds = message.tools.flatMap((tool) => {
        const messages = allMessages.filter((m) => m.tool_call_id === tool.id);
        return messages.map((m) => m.id);
      });
      ids = ids.concat(toolMessageIds);
    }

    await get().optimisticDeleteMessages(ids, context);
  },
  deleteMessage: async (id, context) => {
    const message = displayMessageSelectors.getDisplayMessageById(id)(get());
    if (!message) return;

    let ids = [message.id];

    // Handle assistantGroup messages: delete all child blocks and tool results
    if (message.role === 'assistantGroup' && message.children) {
      // Collect all child block IDs
      const childIds = message.children.map((child) => child.id);
      ids = ids.concat(childIds);

      // Collect all tool result IDs from children
      const toolResultIds = message.children.flatMap((child) => {
        if (!child.tools) return [];
        return child.tools.filter((tool) => tool.result?.id).map((tool) => tool.result!.id);
      });
      ids = ids.concat(toolResultIds);
    }

    await get().optimisticDeleteMessages(ids, context);
  },

  deleteDBMessage: async (id) => {
    const message = dbMessageSelectors.getDbMessageById(id)(get());
    if (!message) return;

    let ids = [message.id];

    get().internal_dispatchMessage({ type: 'deleteMessages', ids });
    const ctx = get().internal_getConversationContext();
    // CRUD operations pass agentId - backend handles sessionId mapping
    const result = await messageService.removeMessages(ids, ctx);

    if (result?.success && result.messages) {
      get().replaceMessages(result.messages, { context: ctx });
    }
  },

  deleteToolMessage: async (id) => {
    const message = dbMessageSelectors.getDbMessageById(id)(get());
    if (!message || message.role !== 'tool') return;

    // Get operationId from messageOperationMap to ensure proper context isolation
    const operationId = get().messageOperationMap[id];
    const context = operationId ? { operationId } : undefined;

    const removeToolInAssistantMessage = async () => {
      if (!message.parentId) return;
      await get().optimisticRemoveToolFromAssistantMessage(
        message.parentId,
        message.tool_call_id,
        context,
      );
    };

    await Promise.all([
      // 1. remove tool message
      get().optimisticDeleteMessage(id, context),
      // 2. remove the tool item in the assistant tools
      removeToolInAssistantMessage(),
    ]);
  },

  clearMessage: async () => {
    const { activeAgentId, activeTopicId, activeGroupId, refreshTopic, switchTopic } = get();

    // For group sessions, we need to clear group messages using groupId
    // For regular sessions, we clear session messages using agentId
    if (activeGroupId) {
      // For group chat, activeGroupId is the groupId
      await messageService.removeMessagesByGroup(activeGroupId, activeTopicId);
    } else {
      // For regular session, activeAgentId is the agentId
      await messageService.removeMessagesByAssistant(activeAgentId, activeTopicId);
    }

    if (activeTopicId) {
      await topicService.removeTopic(activeTopicId);
    }
    await refreshTopic();

    // Clear messages directly since all messages are deleted
    get().replaceMessages([]);

    // after remove topic , go back to default topic
    switchTopic(null);
  },

  clearAllMessages: async () => {
    await messageService.removeAllMessages();
    // Clear messages directly since all messages are deleted
    get().replaceMessages([]);
  },

  copyMessage: async (id, content) => {
    await copyToClipboard(content);

    get().internal_traceMessage(id, { eventType: TraceEventType.CopyMessage });
  },

  toggleMessageEditing: (id, editing) => {
    set(
      { messageEditingIds: toggleBooleanList(get().messageEditingIds, id, editing) },
      false,
      'toggleMessageEditing',
    );
  },

  updateMessageInput: (message) => {
    if (isEqual(message, get().inputMessage)) return;

    set({ inputMessage: message }, false, n('updateMessageInput', message));
  },

  modifyMessageContent: async (id, content, context) => {
    // tracing the diff of update
    // due to message content will change, so we need send trace before update,or will get wrong data
    get().internal_traceMessage(id, {
      eventType: TraceEventType.ModifyMessage,
      nextContent: content,
    });

    await get().optimisticUpdateMessageContent(id, content, undefined, context);
  },

  toggleMessageCollapsed: async (id, collapsed, context) => {
    const message = displayMessageSelectors.getDisplayMessageById(id)(get());
    if (!message) return;

    // 如果没有传入 collapsed，则取反当前状态
    const nextCollapsed = collapsed ?? !message.metadata?.collapsed;

    // 直接调用现有的 optimisticUpdateMessageMetadata
    await get().optimisticUpdateMessageMetadata(id, { collapsed: nextCollapsed }, context);
  },

  toggleInspectExpanded: async (id, expanded, context) => {
    const message = dbMessageSelectors.getDbMessageById(id)(get());
    if (!message) return;

    // 如果没有传入 expanded，则取反当前状态
    const nextExpanded = expanded ?? !message.metadata?.inspectExpanded;

    // 直接调用现有的 optimisticUpdateMessageMetadata
    await get().optimisticUpdateMessageMetadata(id, { inspectExpanded: nextExpanded }, context);
  },
});
