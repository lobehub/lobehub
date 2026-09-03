import useSWR from 'swr';

import { shareKeys } from '@/libs/swr/keys';
import { shareChatService } from '@/services/shareChat';

/**
 * The visitor's own topics on this shared agent (server-scoped by senderId).
 *
 * `enabled` is off for a non-interactive share (see `isShareInteractive`):
 * `shareChat.getTopics` requires `link` visibility, so an owner previewing
 * their own private share would otherwise always see a `FORBIDDEN` panel with
 * a retry that can never succeed. With the fetch skipped the panel falls
 * through to its empty state, which is the truth for a preview.
 */
export const useVisitorTopics = (shareId: string, enabled = true) =>
  useSWR(
    enabled ? shareKeys.visitorTopics(shareId) : null,
    () => shareChatService.getTopics(shareId),
    {
      revalidateOnFocus: false,
    },
  );
