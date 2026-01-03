import { copyToClipboard } from '@lobehub/ui';
import { produce } from 'immer';
import type { StateCreator } from 'zustand';

import type { Store as ConversationStore } from '../../../action';
import { dataSelectors } from '../../data/selectors';

/**
 * Message State Actions
 *
 * Handles message state operations like loading, collapsed, etc.
 */
export interface MessageStateAction {
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
