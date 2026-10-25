import type { SQLWrapper } from 'drizzle-orm';
import { asc, inArray } from 'drizzle-orm';

import { channelMessageFiles } from '../../schemas';
import type { LobeChatDatabase, Transaction } from '../../type';

/**
 * Records a new message's attachments in the order the sender gave them. Performs no access
 * check: the caller must already have authorized every file for the sender
 * (`sendMessage` in `send.ts` does, under the channel lock).
 */
export const attachFiles = async (
  tx: Transaction,
  params: { fileIds: string[]; messageId: string },
) => {
  const { fileIds, messageId } = params;
  if (!fileIds.length) return;

  await tx.insert(channelMessageFiles).values(
    fileIds.map((fileId, sortOrder) => ({
      fileId,
      messageId,
      sortOrder,
    })),
  );
};

/**
 * Attachment ids per message, in attachment order. A file deleted since the message was sent
 * is no longer listed: the cascade removed its row. Pass a subquery rather than an id list when
 * the message set is unbounded, such as a whole branch.
 */
export const fileIdsByMessage = async (
  tx: LobeChatDatabase | Transaction,
  messageIds: string[] | SQLWrapper,
) => {
  const result = new Map<string, string[]>();
  if (Array.isArray(messageIds) && !messageIds.length) return result;

  const rows = await tx
    .select({ fileId: channelMessageFiles.fileId, messageId: channelMessageFiles.messageId })
    .from(channelMessageFiles)
    .where(inArray(channelMessageFiles.messageId, messageIds))
    .orderBy(asc(channelMessageFiles.messageId), asc(channelMessageFiles.sortOrder));
  for (const { fileId, messageId } of rows) {
    const list = result.get(messageId);
    if (list) list.push(fileId);
    else result.set(messageId, [fileId]);
  }

  return result;
};
