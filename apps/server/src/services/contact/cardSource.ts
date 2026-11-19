import type { LobeChatDatabase } from '@lobechat/database';
import type { ContactRequestSource } from '@lobechat/types';
import { TRPCError } from '@trpc/server';

import { ChannelRepository } from '@/database/repositories/channel';
import { findContactCardMessage } from '@/database/repositories/channel/contactCard';

/**
 * The source of a contact request sent from a card in a Channel message. The requester must read
 * that Channel and the card must introduce the addressee; the card's sender is recorded as who
 * recommended them, so a client cannot name a recommender of its choosing.
 */
export const resolveCardRequestSource = async (params: {
  addresseeId: string;
  channelId: string;
  db: LobeChatDatabase;
  messageId: string;
  userId: string;
  workspaceId?: string | null;
}): Promise<ContactRequestSource> => {
  const { addresseeId, channelId, db, messageId, userId, workspaceId } = params;
  const access = await new ChannelRepository(db, userId, workspaceId).findAccess(channelId);
  const found = access && (await findContactCardMessage(db, channelId, messageId));
  if (found?.card.type !== 'user' || found.card.user.id !== addresseeId)
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'The card does not introduce this person',
    });
  return { channelId, messageId, sharedById: found.senderId, type: 'card' };
};
