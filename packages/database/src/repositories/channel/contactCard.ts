import type { ContactCard } from '@lobechat/types';
import { channelMessageDeletedAt, contactCardOf } from '@lobechat/types';
import { and, eq } from 'drizzle-orm';

import { channelMessages } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { isUuid } from '../../utils/uuid';

/**
 * The contact card a Channel message carries and the person who sent it. The caller checks read
 * access to the Channel first; a deleted message or one an Agent wrote carries no usable card.
 */
export const findContactCardMessage = async (
  db: LobeChatDatabase,
  channelId: string,
  messageId: string,
): Promise<{ card: ContactCard; senderId: string } | undefined> => {
  if (!isUuid(messageId)) return undefined;
  const [message] = await db
    .select({ metadata: channelMessages.metadata, userId: channelMessages.userId })
    .from(channelMessages)
    .where(and(eq(channelMessages.channelId, channelId), eq(channelMessages.id, messageId)))
    .limit(1);
  if (!message?.userId || channelMessageDeletedAt(message.metadata)) return undefined;
  const card = contactCardOf(message.metadata);
  return card && { card, senderId: message.userId };
};
