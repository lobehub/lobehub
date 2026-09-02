import { KnowledgeBaseModel } from '@/database/models/knowledgeBase';
import { ResourcePermissionModel } from '@/database/models/resourcePermission';
import type { SoftDeleteOptions } from '@/database/utils/softDelete';

import { purgeFiles } from './purgeFiles';
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
    const knowledgeBaseModel = new KnowledgeBaseModel(ctx.db, ctx.userId, ctx.workspaceId);
    const exclusiveFileIds = await knowledgeBaseModel.findExclusiveFileIds(root.resourceId);
    if (exclusiveFileIds.length > 0) {
      await purgeFiles(ctx, exclusiveFileIds);
    }
    await knowledgeBaseModel.purge([root.resourceId]);
    if (ctx.workspaceId) {
      await new ResourcePermissionModel(ctx.db, ctx.workspaceId).removeAll(
        'knowledgeBase',
        root.resourceId,
      );
    }
  },
  restore: async (ctx, root) => {
    const model = new KnowledgeBaseModel(ctx.db, ctx.userId, ctx.workspaceId);
    const [knowledgeBase] = await model.findTrashedByIds([root.resourceId]);
    if (!knowledgeBase) throw new TrashRestoreError('notFound');
    await model.restore([root.resourceId]);
  },
  type: 'knowledgeBase',
};
