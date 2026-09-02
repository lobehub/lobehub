import { DocumentModel } from '@/database/models/document';
import { FileModel } from '@/database/models/file';
import { ResourcePermissionModel } from '@/database/models/resourcePermission';
import type { SoftDeleteOptions } from '@/database/utils/softDelete';

import { purgeFiles } from './purgeFiles';
import { documentEntry, fileEntry } from './resourceEntries';
import {
  type TrashCascade,
  type TrashHandler,
  type TrashHandlerContext,
  TrashRestoreError,
} from './types';

export const softDeleteDocuments = async (
  ctx: TrashHandlerContext,
  ids: string[],
  options: SoftDeleteOptions,
): Promise<TrashCascade[]> => {
  const documentModel = new DocumentModel(ctx.db, ctx.userId, ctx.workspaceId);
  const fileModel = new FileModel(ctx.db, ctx.userId, ctx.workspaceId);
  const cascades: TrashCascade[] = [];

  for (const id of new Set(ids)) {
    const trashedDocuments = await documentModel.softDeleteSubtree(id, options);
    const root = trashedDocuments.find((document) => document.id === id);
    if (!root) continue;

    const documentIds = trashedDocuments.map((document) => document.id);
    const anchoredFiles = await fileModel.findByParentIds(documentIds);
    const associatedFileIds = trashedDocuments
      .map((document) => document.fileId)
      .filter((fileId): fileId is string => Boolean(fileId));
    const files = await fileModel.softDelete(
      [...new Set([...anchoredFiles.map((file) => file.id), ...associatedFileIds])],
      options,
    );

    cascades.push({
      children: [
        ...trashedDocuments
          .filter((document) => document.id !== root.id)
          .map((document) => documentEntry(document)),
        ...files.map((file) => fileEntry(file)),
      ],
      root: documentEntry(root),
    });
  }

  return cascades;
};

export const documentHandler: TrashHandler = {
  purge: async (ctx, root, children) => {
    const fileIds = children
      .filter((child) => child.resourceType === 'file')
      .map((child) => child.resourceId);
    if (fileIds.length > 0) {
      await purgeFiles(ctx, fileIds, { onlyTrashed: true, root });
    }

    const documentIds = [
      root.resourceId,
      ...children
        .filter((child) => child.resourceType === 'document')
        .map((child) => child.resourceId),
    ];
    await new DocumentModel(ctx.db, ctx.userId, ctx.workspaceId).purge(documentIds);
    if (ctx.workspaceId) {
      const permissionModel = new ResourcePermissionModel(ctx.db, ctx.workspaceId);
      await Promise.all(documentIds.map((id) => permissionModel.removeAll('document', id)));
    }
  },
  restore: async (ctx, root, children) => {
    const documentModel = new DocumentModel(ctx.db, ctx.userId, ctx.workspaceId);
    const [document] = await documentModel.findTrashedByIds([root.resourceId]);
    if (!document) throw new TrashRestoreError('notFound');

    if (document.parentId && (await documentModel.isTrashedParent(document.parentId))) {
      throw new TrashRestoreError('parentTrashed');
    }

    const documentIds = [
      root.resourceId,
      ...children
        .filter((child) => child.resourceType === 'document')
        .map((child) => child.resourceId),
    ];
    const fileIds = children
      .filter((child) => child.resourceType === 'file')
      .map((child) => child.resourceId);
    await documentModel.restore(documentIds);
    await new FileModel(ctx.db, ctx.userId, ctx.workspaceId).restore(fileIds);
  },
  type: 'document',
};
