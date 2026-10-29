import type { LobeChatDatabase } from '@lobechat/database';
import type { ChannelContextMessage } from '@lobechat/types';
import { inArray } from 'drizzle-orm';
import pMap from 'p-map';

import { FileModel } from '@/database/models/file';
import { files } from '@/database/schemas';
import { FileService } from '@/server/services/file';

/** Called only with the repository-authorized frozen input of a claimed job. */
export const resolveChannelAttachments = async (
  db: LobeChatDatabase,
  userId: string,
  workspaceId: string | null,
  input: ChannelContextMessage[],
) => {
  const ids = [...new Set(input.flatMap((message) => message.fileIds ?? []))];
  if (!ids.length) return { fileIds: [] };
  const existing = await new FileModel(db, userId, workspaceId ?? undefined).findByIds(ids);
  const fileIds = existing.map((file) => file.id);
  const missing = ids.filter((id) => !fileIds.includes(id));
  if (!missing.length) return { fileIds };
  const shared = await db.select().from(files).where(inArray(files.id, missing));
  const service = new FileService(db, userId, workspaceId ?? undefined);
  // Import another participant's deliberately shared attachment into this ordinary
  // private run through the existing ingestion path. Ordinary file ACLs stay intact.
  // Each import buffers a whole file, so download a few at a time.
  const imported = await pMap(
    shared,
    async (file) => ({
      buffer: Buffer.from(await service.getFileByteArray(file.url)),
      mimeType: file.fileType,
      name: file.name,
      size: file.size,
    }),
    { concurrency: 3 },
  );
  return { fileIds, files: imported };
};
