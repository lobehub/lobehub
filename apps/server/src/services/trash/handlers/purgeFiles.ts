import { serverDBEnv } from '@/config/db';
import { FileModel } from '@/database/models/file';

import type { TrashHandlerContext } from './types';

export const purgeFiles = async (
  ctx: TrashHandlerContext,
  ids: string[],
  options?: { onlyTrashed?: boolean },
) => {
  await new FileModel(ctx.db, ctx.userId, ctx.workspaceId).deleteMany(
    ids,
    serverDBEnv.REMOVE_GLOBAL_FILE,
    {
      ...options,
      beforeDeleteGlobalFiles: async (files) => {
        const urls = files.flatMap((file) => (file.url ? [file.url] : []));
        if (urls.length > 0) await ctx.fileService.deleteFiles(urls);
      },
    },
  );
};
