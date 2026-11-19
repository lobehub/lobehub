import type { LobeChatDatabase } from '@lobechat/database';

import { ChannelService } from '@/server/services/channel/ChannelService';

export interface OpenContactConversationParams {
  /** Who was asked; the other side of the conversation. */
  addresseeId: string;
  db: LobeChatDatabase;
  /** Who sent the request; always allowed to open it in the request's scope. */
  requesterId: string;
  /** The request's scope: `null` is the personal space. */
  workspaceId: string | null;
}

/**
 * Open the one-on-one conversation of two people who just became contacts, so it lands in both
 * lists without either of them having to start it. Opening is idempotent, and it never fails the
 * acceptance: either person can still open it later from the contact.
 */
export const openContactConversation = async ({
  addresseeId,
  db,
  requesterId,
  workspaceId,
}: OpenContactConversationParams) => {
  try {
    await new ChannelService(db, requesterId, workspaceId ?? undefined).openPeer(addresseeId);
  } catch (error) {
    console.error('[contact] Failed to open the conversation of new contacts', {
      addresseeId,
      error,
      requesterId,
      workspaceId,
    });
  }
};
