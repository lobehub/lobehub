import { serverDBEnv } from '@/config/db';
import { AgentModel } from '@/database/models/agent';
import { FileModel } from '@/database/models/file';
import { TopicModel } from '@/database/models/topic';
import type { TrashRegisterEntry } from '@/database/models/trash';
import type { TopicItem } from '@/database/schemas';

import {
  type TrashCascade,
  type TrashHandler,
  type TrashHandlerContext,
  TrashRestoreError,
} from './types';

export const topicEntry = (topic: TopicItem, removeFiles?: boolean): TrashRegisterEntry => ({
  meta: removeFiles ? { removeFiles: true } : undefined,
  resourceId: topic.id,
  resourceType: 'topic',
  title: topic.title,
});

/**
 * Every stamped topic becomes its own root (a bulk "clear topics" is N
 * restorable rows, the same way a multi-select delete in a file manager is).
 * Messages / threads under it are hidden by the parent and hard-cascade at
 * purge time.
 */
export const topicCascades = (topics: TopicItem[], removeFiles?: boolean): TrashCascade[] =>
  topics.map((topic) => ({ children: [], root: topicEntry(topic, removeFiles) }));

export const topicHandler: TrashHandler = {
  purge: async (ctx, root) => {
    // `removeFiles` was requested at delete time: collect the attachments only
    // this topic still references (same reference-safe set the hard delete
    // used). Computed now, not at trash time, so a file that got attached
    // elsewhere meanwhile is kept — and before the delete, because the lookup
    // joins the messages the delete cascades away.
    const fileModel = new FileModel(ctx.db, ctx.userId, ctx.workspaceId);
    const fileIds = root.meta?.removeFiles
      ? await fileModel.findDeletableFilesByTopicId(root.resourceId)
      : [];

    const purged = await new TopicModel(ctx.db, ctx.userId, ctx.workspaceId).purge([
      root.resourceId,
    ]);
    // Nothing deleted means the topic was restored in the meantime: leave its
    // attachments alone too.
    if (purged.length === 0 || fileIds.length === 0) return;

    const removed = await fileModel.deleteMany(fileIds, serverDBEnv.REMOVE_GLOBAL_FILE);
    if (removed && removed.length > 0) {
      await ctx.fileService.deleteFiles(removed.map((file) => file.url!));
    }
  },
  restore: async (ctx: TrashHandlerContext, root) => {
    const topicModel = new TopicModel(ctx.db, ctx.userId, ctx.workspaceId);
    const [topic] = await topicModel.findTrashedByIds([root.resourceId]);
    if (!topic) throw new TrashRestoreError('notFound');

    // A topic that hangs off an agent sitting in the bin — directly, or only
    // through a legacy session shell — would come back into an invisible
    // container: restore the agent first.
    const agentModel = new AgentModel(ctx.db, ctx.userId, ctx.workspaceId);
    if (await agentModel.hasTrashedOwner(topic)) throw new TrashRestoreError('parentTrashed');

    // The row can be purged between the read above and this write (an expiry
    // sweep or another request). Only a row this update actually brought back
    // counts; otherwise the registry entry must not be dropped as "restored".
    const restored = await topicModel.restore([root.resourceId]);
    if (restored.length === 0) throw new TrashRestoreError('notFound');
  },
  type: 'topic',
};
