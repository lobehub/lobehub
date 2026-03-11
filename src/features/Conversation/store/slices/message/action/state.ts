import { copyToClipboard } from '@lobehub/ui';
import { produce } from 'immer';
import { type StateCreator } from 'zustand';

import { messageService } from '@/services/message';

import { type Store as ConversationStore } from '../../../action';
import { dataSelectors } from '../../data/selectors';

/**
 * Message State Actions
 *
 * Handles message state operations like loading, collapsed, etc.
 */
export interface MessageStateAction {
  /**
   * Cancel compression and restore original messages
   */
  cancelCompression: (id: string) => Promise<void>;

  /**
   * Copy message content to clipboard
   */
  copyMessage: (id: string, content: string) => Promise<void>;

  /**
   * Toggle message loading state
   */
  internal_toggleMessageLoading: (loading: boolean, id: string) => void;

  /**
   * Modify message content (with optimistic update)
   */
  modifyMessageContent: (id: string, content: string) => Promise<void>;

  /**
   * Toggle compressed group expanded state
   */
  toggleCompressedGroupExpanded: (id: string, expanded?: boolean) => Promise<void>;

  /**
   * Toggle tool inspect expanded state
   */
  toggleInspectExpanded: (id: string, expanded?: boolean) => Promise<void>;

  /**
   * Toggle message collapsed state
   */
  toggleMessageCollapsed: (id: string, collapsed?: boolean) => Promise<void>;
}

export const messageStateSlice: StateCreator<
  ConversationStore,
  [['zustand/devtools', never]],
  [],
  MessageStateAction
> = (set, get) => ({
  cancelCompression: async (id) => {
    const message = dataSelectors.getDisplayMessageById(id)(get());
    if (!message || message.role !== 'compressedGroup') return;

    const { context, replaceMessages } = get();
    if (!context.agentId || !context.topicId) return;

    // Call service to cancel compression
    const { messages } = await messageService.cancelCompression({
      agentId: context.agentId,
      groupId: context.groupId,
      messageGroupId: id,
      threadId: context.threadId,
      topicId: context.topicId,
    });

    // Replace messages with restored original messages
    replaceMessages(messages);
  },

  copyMessage: async (id, content) => {
    const { hooks } = get();

    await copyToClipboard(content);

    // ===== Hook: onMessageCopied =====
    if (hooks.onMessageCopied) {
      hooks.onMessageCopied(id);
    }
  },

  internal_toggleMessageLoading: (loading, id) => {
    set(
      (state) => ({
        messageLoadingIds: produce(state.messageLoadingIds, (draft) => {
          if (loading) {
            if (!draft.includes(id)) draft.push(id);
          } else {
            const index = draft.indexOf(id);
            if (index >= 0) draft.splice(index, 1);
          }
        }),
      }),
      false,
      loading ? 'toggleMessageLoading/start' : 'toggleMessageLoading/end',
    );
  },

  modifyMessageContent: async (id, content) => {
    const { hooks } = get();

    // Get original content for hook
    const originalMessage = dataSelectors.getDisplayMessageById(id)(get());
    const originalContent = originalMessage?.content;

    // Update content
    await get().updateMessageContent(id, content);

    // ===== Hook: onMessageModified =====
    if (hooks.onMessageModified) {
      hooks.onMessageModified(id, content, originalContent);
    }
  },

  toggleCompressedGroupExpanded: async (id, expanded) => {
    const message = dataSelectors.getDisplayMessageById(id)(get());
    if (!message || message.role !== 'compressedGroup') return;

    const { context, internal_dispatchMessage, replaceMessages } = get();
    if (!context.agentId || !context.topicId) return;

    // If expanded is not provided, toggle current state
    const currentExpanded = (message.metadata as any)?.expanded ?? false;
    const nextExpanded = expanded ?? !currentExpanded;

    // Optimistic update
    internal_dispatchMessage({
      id,
      type: 'updateMessageGroupMetadata',
      value: { expanded: nextExpanded },
    });

    // Persist to server and get updated messages
    const { messages } = await messageService.updateMessageGroupMetadata({
      context: {
        agentId: context.agentId,
        groupId: context.groupId,
        threadId: context.threadId,
        topicId: context.topicId,
      },
      expanded: nextExpanded,
      messageGroupId: id,
    });

    // Sync with server data
    replaceMessages(messages);
  },

  toggleInspectExpanded: async (id, expanded) => {
    const message = dataSelectors.getDbMessageById(id)(get());
    if (!message) return;

    // If expanded is not provided, toggle current state
    const nextExpanded = expanded ?? !message.metadata?.inspectExpanded;

    // Use optimistic update
    await get().updateMessageMetadata(id, { inspectExpanded: nextExpanded });
  },

  toggleMessageCollapsed: async (id, collapsed) => {
    const message = dataSelectors.getDisplayMessageById(id)(get());
    if (!message) return;

    // If collapsed is not provided, toggle current state
    const nextCollapsed = collapsed ?? !message.metadata?.collapsed;

    // Use optimistic update
    await get().updateMessageMetadata(id, { collapsed: nextCollapsed });
  },
});
