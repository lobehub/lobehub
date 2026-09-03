import { DocumentModel } from '@/database/models/document';
import { FileModel } from '@/database/models/file';
import { lockDocumentHierarchy } from '@/database/utils/documentHierarchy';
import type { SoftDeleteOptions } from '@/database/utils/softDelete';

import { purgeFiles } from './purgeFiles';
import { documentEntry, fileEntry } from './resourceEntries';
import { softDeleteResourceClosures } from './softDeleteResourceClosure';
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
  const closures = await softDeleteResourceClosures(ctx, { fileIds: ids }, options);

  return closures.flatMap(({ detachedEdges, documents, files, root: closureRoot }) => {
    const root = files.find((file) => file.id === closureRoot.id);
    if (!root) return [];
    const rootEntry = fileEntry(root);
    return [
      {
        children: [
          ...documents.map((document) => documentEntry(document)),
          ...files.filter((file) => file.id !== root.id).map((file) => fileEntry(file)),
        ],
        root: {
          ...rootEntry,
          meta: { ...rootEntry.meta, detachedEdges },
        },
      },
    ];
  });
};

export const fileHandler: TrashHandler = {
  purge: async (ctx, root, children) => {
    const fileIds = [
      root.resourceId,
      ...children.filter((child) => child.resourceType === 'file').map((child) => child.resourceId),
    ];
    await purgeFiles(ctx, fileIds, { onlyTrashed: true, root });

    const documentIds = children
      .filter((child) => child.resourceType === 'document')
      .map((child) => child.resourceId);
    await new DocumentModel(ctx.db, ctx.userId, ctx.workspaceId).purge(documentIds);
  },
  restore: async (ctx, root, children) => {
    await lockDocumentHierarchy(ctx.db, ctx.userId, ctx.workspaceId);
    const fileModel = new FileModel(ctx.db, ctx.userId, ctx.workspaceId);
    const documentModel = new DocumentModel(ctx.db, ctx.userId, ctx.workspaceId);
    const [file] = await fileModel.findTrashedByIds([root.resourceId]);
    if (!file) throw new TrashRestoreError('notFound');

    if (file.parentId && (await documentModel.isTrashedParent(file.parentId))) {
      throw new TrashRestoreError('parentTrashed');
    }

    const fileIds = [
      root.resourceId,
      ...children.filter((child) => child.resourceType === 'file').map((child) => child.resourceId),
    ];
    await fileModel.restore(fileIds);
    const documentIds = children
      .filter((child) => child.resourceType === 'document')
      .map((child) => child.resourceId);
    await documentModel.restore(documentIds);
    const detachedEdges = root.meta?.detachedEdges ?? [];
    await documentModel.restoreDetachedParents(detachedEdges);
    await fileModel.restoreDetachedParents(detachedEdges);
  },
  type: 'file',
};
