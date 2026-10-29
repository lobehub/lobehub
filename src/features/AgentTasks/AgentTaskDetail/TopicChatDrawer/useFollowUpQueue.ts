import { type IEditor } from '@lobehub/editor';
import { useEffect } from 'react';

import { useRestoreServerQueue } from '@/features/Conversation/ChatInput/useRestoreServerQueue';
import { useConversationStore, useConversationStoreApi } from '@/features/Conversation/store';
import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';

interface UseFollowUpQueueParams {
  /** The drawer's own composer editor, which the queue's Edit refills. */
  editor?: IEditor | null;
  /** Whether the viewer may reply; a view-only member never queues follow-ups. */
  enabled: boolean;
  /** Whether the user has the composer open. */
  expanded: boolean;
  /** Opens the composer without focusing it. */
  reveal: () => void;
}

/**
 * Wires the drawer composer to the follow-up queue the main chat input shows.
 *
 * A follow-up typed while the run works is queued, not sent; without this the
 * drawer showed nothing until the run took it in as a steered message, so it
 * could not be read, edited or withdrawn.
 *
 * Returns:
 * - `hasQueuedMessages`: whether the queue tray has rows to show.
 * - `composerExpanded`: whether the composer must be open. A queued follow-up
 *   opens it for good, not only while queued: Edit withdraws the last message
 *   into the editor, which empties the queue, and a composer that collapsed then
 *   would lose the text.
 */
export const useFollowUpQueue = ({ editor, enabled, expanded, reveal }: UseFollowUpQueueParams) => {
  const context = useConversationStore((s) => s.context);
  const storeApi = useConversationStoreApi();

  useRestoreServerQueue(context, enabled);
  const hasQueuedMessages = useChatStore(
    (s) => enabled && operationSelectors.queuedMessageCount(context)(s) > 0,
  );

  // Set the editor on this conversation only: the store's `setEditor` also
  // claims the global main-input editor, which belongs to the chat behind the drawer.
  useEffect(() => {
    if (editor) storeApi.setState({ editor });
  }, [editor, storeApi]);

  useEffect(() => {
    if (hasQueuedMessages) reveal();
  }, [hasQueuedMessages, reveal]);

  return { composerExpanded: expanded || hasQueuedMessages, hasQueuedMessages };
};
