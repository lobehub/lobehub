/* eslint-disable sort-keys-fix/sort-keys-fix,typescript-sort-keys/interface */
import { TraceEventType } from '@lobechat/types';
import { copyToClipboard } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';

import { messageService } from '@/services/message';
import { topicService } from '@/services/topic';
import { type ChatStore } from '@/store/chat/store';
import { type StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import { dbMessageSelectors, displayMessageSelectors } from '../../../selectors';
import { toggleBooleanList } from '../../../utils';
import { type OptimisticUpdateContext } from './optimisticUpdate';

const n = setNamespace('m');

/**
 * Public API for components
 * These methods are directly called by UI components
 */

type Setter = StoreSetter<ChatStore>;
export const messagePublicApi = (set: Setter, get: () => ChatStore, _api?: unknown) =>
  new MessagePublicApiActionImpl(set, get, _api);

export class MessagePublicApiActionImpl {
  readonly #get: () => ChatStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => ChatStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  addAIMessage = async (): Promise<void> => {
    const {
      optimisticCreateMessage,
      updateMessageInput,
      activeTopicId,
      activeAgentId,
      activeThreadId,
      activeGroupId,
      inputMessage,
    } = this.#get();
    if (!activeAgentId) return;

    const parentId = displayMessageSelectors.lastDisplayMessageId(this.#get());

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
  };

  addUserMessage = async ({
    message,
    fileList,
  }: {
    message: string;
    fileList?: string[];
  }): Promise<void> => {
    const {
      optimisticCreateMessage,
      updateMessageInput,
      activeTopicId,
      activeAgentId,
      activeThreadId,
      activeGroupId,
    } = this.#get();
    if (!activeAgentId) return;

    const parentId = displayMessageSelectors.lastDisplayMessageId(this.#get());

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
  };

  deleteAssistantMessage = async (id: string, context?: OptimisticUpdateContext): Promise<void> => {
    const message = dbMessageSelectors.getDbMessageById(id)(this.#get());
    if (!message) return;

    let ids = [message.id];
    if (message.tools) {
      const allMessages = dbMessageSelectors.activeDbMessages(this.#get());

      const toolMessageIds = message.tools.flatMap((tool) => {
        const messages = allMessages.filter((m) => m.tool_call_id === tool.id);
        return messages.map((m) => m.id);
      });
      ids = ids.concat(toolMessageIds);
    }

    await this.#get().optimisticDeleteMessages(ids, context);
  };

  deleteMessage = async (id: string, context?: OptimisticUpdateContext): Promise<void> => {
    const message = displayMessageSelectors.getDisplayMessageById(id)(this.#get());
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

    await this.#get().optimisticDeleteMessages(ids, context);
  };

  deleteDBMessage = async (id: string): Promise<void> => {
    const message = dbMessageSelectors.getDbMessageById(id)(this.#get());
    if (!message) return;

    const ids = [message.id];

    this.#get().internal_dispatchMessage({ type: 'deleteMessages', ids });
    const ctx = this.#get().internal_getConversationContext();
    // CRUD operations pass agentId - backend handles sessionId mapping
    const result = await messageService.removeMessages(ids, ctx);

    if (result?.success && result.messages) {
      this.#get().replaceMessages(result.messages, { context: ctx });
    }
  };

  deleteToolMessage = async (id: string): Promise<void> => {
    const message = dbMessageSelectors.getDbMessageById(id)(this.#get());
    if (!message || message.role !== 'tool') return;

    // Get operationId from messageOperationMap to ensure proper context isolation
    const operationId = this.#get().messageOperationMap[id];
    const context = operationId ? { operationId } : undefined;

    const removeToolInAssistantMessage = async () => {
      if (!message.parentId) return;
      await this.#get().optimisticRemoveToolFromAssistantMessage(
        message.parentId,
        message.tool_call_id,
        context,
      );
    };

    await Promise.all([
      // 1. remove tool message
      this.#get().optimisticDeleteMessage(id, context),
      // 2. remove the tool item in the assistant tools
      removeToolInAssistantMessage(),
    ]);
  };

  clearMessage = async (): Promise<void> => {
    const { activeAgentId, activeTopicId, activeGroupId, refreshTopic, switchTopic } = this.#get();

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
    this.#get().replaceMessages([]);

    // after remove topic , go back to default topic
    switchTopic(null);
  };

  clearAllMessages = async (): Promise<void> => {
    await messageService.removeAllMessages();
    // Clear messages directly since all messages are deleted
    this.#get().replaceMessages([]);
  };

  copyMessage = async (id: string, content: string): Promise<void> => {
    await copyToClipboard(content);

    this.#get().internal_traceMessage(id, { eventType: TraceEventType.CopyMessage });
  };

  toggleMessageEditing = (id: string, editing: boolean): void => {
    this.#set(
      { messageEditingIds: toggleBooleanList(this.#get().messageEditingIds, id, editing) },
      false,
      'toggleMessageEditing',
    );
  };

  updateMessageInput = (message: string): void => {
    if (isEqual(message, this.#get().inputMessage)) return;

    this.#set({ inputMessage: message }, false, n('updateMessageInput', message));
  };

  modifyMessageContent = async (
    id: string,
    content: string,
    context?: OptimisticUpdateContext,
  ): Promise<void> => {
    // tracing the diff of update
    // due to message content will change, so we need send trace before update,or will get wrong data
    this.#get().internal_traceMessage(id, {
      eventType: TraceEventType.ModifyMessage,
      nextContent: content,
    });

    await this.#get().optimisticUpdateMessageContent(id, content, undefined, context);
  };

  toggleMessageCollapsed = async (
    id: string,
    collapsed?: boolean,
    context?: OptimisticUpdateContext,
  ): Promise<void> => {
    const message = displayMessageSelectors.getDisplayMessageById(id)(this.#get());
    if (!message) return;

    // 如果没有传入 collapsed，则取反当前状态
    const nextCollapsed = collapsed ?? !message.metadata?.collapsed;

    // 直接调用现有的 optimisticUpdateMessageMetadata
    await this.#get().optimisticUpdateMessageMetadata(id, { collapsed: nextCollapsed }, context);
  };

  toggleInspectExpanded = async (
    id: string,
    expanded?: boolean,
    context?: OptimisticUpdateContext,
  ): Promise<void> => {
    const message = dbMessageSelectors.getDbMessageById(id)(this.#get());
    if (!message) return;

    // 如果没有传入 expanded，则取反当前状态
    const nextExpanded = expanded ?? !message.metadata?.inspectExpanded;

    // 直接调用现有的 optimisticUpdateMessageMetadata
    await this.#get().optimisticUpdateMessageMetadata(
      id,
      { inspectExpanded: nextExpanded },
      context,
    );
  };
}

export type MessagePublicApiAction = Pick<
  MessagePublicApiActionImpl,
  keyof MessagePublicApiActionImpl
>;
