import { DocumentModel } from '@/database/models/document';
import { FileModel } from '@/database/models/file';
import { ResourcePermissionModel } from '@/database/models/resourcePermission';
import { lockDocumentHierarchy } from '@/database/utils/documentHierarchy';
import type { SoftDeleteOptions } from '@/database/utils/softDelete';

import { assertRestorableParents } from './assertRestorableParents';
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
    if (ctx.workspaceId) {
      await new ResourcePermissionModel(ctx.db, ctx.workspaceId).removeAllByIds(
        'document',
        documentIds,
      );
    }
  },
  restore: async (ctx, root, children) => {
    await lockDocumentHierarchy(ctx.db, ctx.userId, ctx.workspaceId);
    const fileModel = new FileModel(ctx.db, ctx.userId, ctx.workspaceId);
    const documentModel = new DocumentModel(ctx.db, ctx.userId, ctx.workspaceId);
    const fileIds = [
      root.resourceId,
      ...children.filter((child) => child.resourceType === 'file').map((child) => child.resourceId),
    ];
    const documentIds = children
      .filter((child) => child.resourceType === 'document')
      .map((child) => child.resourceId);
    const [trashedFiles, trashedDocuments] = await Promise.all([
      fileModel.findTrashedByIds(fileIds),
      documentModel.findTrashedByIds(documentIds),
    ]);
    if (!trashedFiles.some((file) => file.id === root.resourceId)) {
      throw new TrashRestoreError('notFound');
    }
    await assertRestorableParents(
      documentModel,
      [...trashedFiles, ...trashedDocuments],
      documentIds,
    );

    await fileModel.restore(fileIds);
    await documentModel.restore(documentIds);
    const detachedEdges = root.meta?.detachedEdges ?? [];
    await documentModel.restoreDetachedParents(detachedEdges);
    await fileModel.restoreDetachedParents(detachedEdges);
  },
  type: 'file',
};
