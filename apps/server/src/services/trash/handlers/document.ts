import { DocumentModel } from '@/database/models/document';
import { FileModel } from '@/database/models/file';
import { ResourcePermissionModel } from '@/database/models/resourcePermission';
import { lockDocumentHierarchy } from '@/database/utils/documentHierarchy';
import type { SoftDeleteOptions } from '@/database/utils/softDelete';

import { purgeFiles } from './purgeFiles';
import { documentEntry, fileEntry } from './resourceEntries';
import { softDeleteResourceClosure } from './softDeleteResourceClosure';
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
  const cascades: TrashCascade[] = [];

  for (const id of new Set(ids)) {
    const { detachedEdges, documents, files } = await softDeleteResourceClosure(
      ctx,
      { documentIds: [id] },
      options,
    );
    const root = documents.find((document) => document.id === id);
    if (!root) continue;

    const rootEntry = documentEntry(root);
    cascades.push({
      children: [
        ...documents
          .filter((document) => document.id !== root.id)
          .map((document) => documentEntry(document)),
        ...files.map((file) => fileEntry(file)),
      ],
      root: {
        ...rootEntry,
        meta: {
          ...rootEntry.meta,
          detachedEdges,
        },
      },
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
    await lockDocumentHierarchy(ctx.db, ctx.userId, ctx.workspaceId);
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
    const fileModel = new FileModel(ctx.db, ctx.userId, ctx.workspaceId);
    await fileModel.restore(fileIds);
    const detachedEdges = root.meta?.detachedEdges ?? [];
    await documentModel.restoreDetachedParents(detachedEdges);
    await fileModel.restoreDetachedParents(detachedEdges);
  },
  type: 'document',
};
