import { useCallback } from 'react';

import { useChatStore } from '@/store/chat';
import { type PortalFile } from '@/store/chat/slices/portal/initialState';

import { useConversationStore } from '../store';

/**
 * Opens a file preview tagged with the isolated conversation it came from.
 *
 * Use when:
 * - A message inside a conversation opens a file in the portal.
 *
 * Expects:
 * - To render inside a `ConversationProvider`.
 *
 * Returns:
 * - A preview opener. Inside an isolated Topic (the Task run drawer) the
 *   preview carries that Topic, so the drawer shows it in place instead of in
 *   a page portal the floating drawer would cover.
 */
export const useOpenConversationFilePreview = () => {
  const openFilePreview = useChatStore((s) => s.openFilePreview);
  const sourceTopicId = useConversationStore((s) =>
    s.context.isolatedTopic ? (s.context.topicId ?? undefined) : undefined,
  );

  return useCallback(
    (file: PortalFile) => openFilePreview(file, { sourceTopicId }),
    [openFilePreview, sourceTopicId],
  );
};
