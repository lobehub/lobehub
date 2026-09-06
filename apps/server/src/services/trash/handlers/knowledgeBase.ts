import { DocumentModel } from '@/database/models/document';
import { KnowledgeBaseModel } from '@/database/models/knowledgeBase';
import { ResourcePermissionModel } from '@/database/models/resourcePermission';
import type { LobeChatDatabase } from '@/database/type';
import type { SoftDeleteOptions } from '@/database/utils/softDelete';

import { purgeFileRecords, purgeFiles } from './purgeFiles';
import { knowledgeBaseEntry } from './resourceEntries';
import {
  type TrashCascade,
  type TrashHandler,
  type TrashHandlerContext,
  TrashRestoreError,
} from './types';

export const softDeleteKnowledgeBases = async (
  ctx: TrashHandlerContext,
  ids: string[],
  options: SoftDeleteOptions,
): Promise<TrashCascade[]> => {
  const knowledgeBases = await new KnowledgeBaseModel(
    ctx.db,
    ctx.userId,
    ctx.workspaceId,
  ).softDelete(ids, options);
  return knowledgeBases.map((knowledgeBase) => ({
    children: [],
    root: knowledgeBaseEntry(knowledgeBase),
  }));
};

export const knowledgeBaseHandler: TrashHandler = {
  purge: async (ctx, root) => {
    await ctx.db.transaction(async (tx) => {
      const db = tx as LobeChatDatabase;
      const transactionCtx = { ...ctx, db };
      const knowledgeBaseModel = new KnowledgeBaseModel(db, ctx.userId, ctx.workspaceId);

      await knowledgeBaseModel.lockLinkedFiles(root.resourceId);
      const exclusiveFileIds = await knowledgeBaseModel.findExclusiveFileIds(root.resourceId);
      const exclusiveDocumentIds = await knowledgeBaseModel.lockPurgeDocumentIds(
        root.resourceId,
        exclusiveFileIds,
      );
      const deletedDocuments = await new DocumentModel(db, ctx.userId, ctx.workspaceId).deleteMany(
        exclusiveDocumentIds,
      );
      if (exclusiveFileIds.length > 0) {
        // Delete database rows and persist the S3 retry hand-off while the
        // shared-file lock is held. External storage cleanup runs after commit.
        await purgeFileRecords(transactionCtx, exclusiveFileIds, { root });
      }
      await knowledgeBaseModel.purge([root.resourceId]);
      if (ctx.workspaceId) {
        const permissionModel = new ResourcePermissionModel(db, ctx.workspaceId);
        await permissionModel.removeAll('knowledgeBase', root.resourceId);
        await permissionModel.removeAllByIds(
          'document',
          deletedDocuments.map(({ id }) => id),
        );
      }
    });

    // Re-read the durable hand-off written above; this is also the retry path
    // when the KB rows were already committed but a previous S3 call failed.
    await purgeFiles(ctx, [], { root });
  },
  restore: async (ctx, root) => {
    const model = new KnowledgeBaseModel(ctx.db, ctx.userId, ctx.workspaceId);
    const [knowledgeBase] = await model.findTrashedByIds([root.resourceId]);
    if (!knowledgeBase) throw new TrashRestoreError('notFound');
    await model.restore([root.resourceId]);
  },
  type: 'knowledgeBase',
};
