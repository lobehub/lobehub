import { DocumentModel } from '@/database/models/document';
import { FileModel } from '@/database/models/file';
import type { SoftDeleteOptions } from '@/database/utils/softDelete';

import { purgeFiles } from './purgeFiles';
import { documentEntry, fileEntry } from './resourceEntries';
import {
  type TrashCascade,
  type TrashHandler,
  type TrashHandlerContext,
  TrashRestoreError,
} from './types';

export const softDeleteFiles = async (
  ctx: TrashHandlerContext,
  ids: string[],
  options: SoftDeleteOptions,
): Promise<TrashCascade[]> => {
  const fileModel = new FileModel(ctx.db, ctx.userId, ctx.workspaceId);
  const documentModel = new DocumentModel(ctx.db, ctx.userId, ctx.workspaceId);
  const trashedFiles = await fileModel.softDelete(ids, options);
  const mirrorDocuments = await documentModel.findByFileIds(trashedFiles.map((file) => file.id));
  const trashedDocuments = await documentModel.softDelete(
    mirrorDocuments.map((document) => document.id),
    options,
  );

  return trashedFiles.map((file) => ({
    children: trashedDocuments
      .filter((document) => document.fileId === file.id)
      .map((document) => documentEntry(document)),
    root: fileEntry(file),
  }));
};

export const fileHandler: TrashHandler = {
  purge: async (ctx, root) => {
    await purgeFiles(ctx, [root.resourceId], { onlyTrashed: true });
  },
  restore: async (ctx, root, children) => {
    const fileModel = new FileModel(ctx.db, ctx.userId, ctx.workspaceId);
    const [file] = await fileModel.findTrashedByIds([root.resourceId]);
    if (!file) throw new TrashRestoreError('notFound');

    if (file.parentId) {
      const [parent] = await new DocumentModel(
        ctx.db,
        ctx.userId,
        ctx.workspaceId,
      ).findTrashedByIds([file.parentId]);
      if (parent) throw new TrashRestoreError('parentTrashed');
    }

    await fileModel.restore([root.resourceId]);
    const documentIds = children
      .filter((child) => child.resourceType === 'document')
      .map((child) => child.resourceId);
    await new DocumentModel(ctx.db, ctx.userId, ctx.workspaceId).restore(documentIds);
  },
  type: 'file',
};
