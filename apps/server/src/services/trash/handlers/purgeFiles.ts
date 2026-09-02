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
  const trashModel = new TrashModel(ctx.db, ctx.userId, ctx.workspaceId);
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

  // A concurrent purge may have entered with a stale root object, waited for
  // the first file transaction, and then observed no source rows. Re-read the
  // registry after commit so that invocation cannot skip the retry hand-off
  // written by its peer and remove the root prematurely.
  const latestRoot = await trashModel.findByIdIncludingQueued(options.root.id);
  const filesToDelete = latestRoot?.meta?.storageCleanup?.files ?? toStorageFiles(storageFiles);
  const urls = filesToDelete.map(({ url }) => url);
  if (urls.length > 0) await ctx.fileService.deleteFiles(urls);
};
