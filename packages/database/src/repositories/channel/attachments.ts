import type { SQLWrapper } from 'drizzle-orm';
import { asc, inArray } from 'drizzle-orm';

import { channelMessageFiles, files } from '../../schemas';
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

/** A positive finite pixel count from caller-written JSON metadata, or `null`. */
const pixels = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : null;

/** A base64 ThumbHash from caller-written JSON metadata, or `null`. A real one is ~25-35 chars. */
const thumbhashOf = (value: unknown) =>
  typeof value === 'string' && /^[\d+/A-Za-z]{8,64}={0,2}$/.test(value) ? value : null;

/**
 * The attachments a Channel shows, by file id. `width` / `height` are the picture's intrinsic
 * pixels as the uploader recorded them in `metadata`, so a client can size the picture's box
 * before fetching it; `null` when unknown (not an image, or an upload that did not record them).
 * `thumbhash` is the base64 ThumbHash recorded at upload, painted as a blurred preview while the
 * picture loads; `null` when unknown. Nothing else in `metadata` is returned: it also holds the storage path.
 */
export const channelAttachments = async (tx: LobeChatDatabase | Transaction, ids: string[]) => {
  if (!ids.length) return [];

  const rows = await tx
    .select({
      fileType: files.fileType,
      id: files.id,
      metadata: files.metadata,
      name: files.name,
      size: files.size,
      url: files.url,
    })
    .from(files)
    .where(inArray(files.id, ids));
  return rows.map(({ metadata, ...file }) => {
    const meta = (metadata ?? {}) as { height?: unknown; thumbhash?: unknown; width?: unknown };
    const [width, height] = [pixels(meta.width), pixels(meta.height)];
    // Half a size reserves nothing: report both or neither.
    const known = width !== null && height !== null;
    return {
      ...file,
      height: known ? height : null,
      thumbhash: thumbhashOf(meta.thumbhash),
      width: known ? width : null,
    };
  });
};
