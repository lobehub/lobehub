import { serverDBEnv } from '@/config/db';
import { FileModel } from '@/database/models/file';
import { TrashModel } from '@/database/models/trash';
import type { TrashItemRow } from '@/database/schemas';

import type { TrashHandlerContext } from './types';

const toStorageFiles = (files: { fileHash: string | null; url: string }[]) => [
  ...new Map(
    files.flatMap((file) =>
      file.fileHash && file.url
        ? [[`${file.fileHash}:${file.url}`, { fileHash: file.fileHash, url: file.url }] as const]
        : [],
    ),
  ).values(),
];

export const purgeFiles = async (
  ctx: TrashHandlerContext,
  ids: string[],
  options: { onlyTrashed?: boolean; root: TrashItemRow },
) => {
  const pendingFiles = options.root.meta?.storageCleanup?.files;
  if (pendingFiles?.length) {
    await ctx.fileService.deleteFiles(pendingFiles.map(({ url }) => url));
    return;
  }

  const storageFiles = await new FileModel(ctx.db, ctx.userId, ctx.workspaceId).deleteMany(
    ids,
    serverDBEnv.REMOVE_GLOBAL_FILE,
    {
      beforeCommitGlobalFileDelete: async (trx, files) => {
        await TrashModel.markStorageCleanupPending(trx, options.root.id, toStorageFiles(files));
      },
      onlyTrashed: options.onlyTrashed,
    },
  );

  const urls = toStorageFiles(storageFiles).map(({ url }) => url);
  if (urls.length > 0) await ctx.fileService.deleteFiles(urls);
};
