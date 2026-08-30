import { serverDBEnv } from '@/config/db';
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
    // `removeFiles` was requested at delete time: drop the attachments only
    // this topic still references (same reference-safe set the hard delete
    // used), then their storage objects. Computed now, not at trash time, so a
    // file that got attached elsewhere meanwhile is kept.
    if (root.meta?.removeFiles) {
      const fileModel = new FileModel(ctx.db, ctx.userId, ctx.workspaceId);
      const fileIds = await fileModel.findDeletableFilesByTopicId(root.resourceId);
      if (fileIds.length > 0) {
        const removed = await fileModel.deleteMany(fileIds, serverDBEnv.REMOVE_GLOBAL_FILE);
        if (removed && removed.length > 0) {
          await ctx.fileService.deleteFiles(removed.map((file) => file.url!));
        }
      }
    }
    await new TopicModel(ctx.db, ctx.userId, ctx.workspaceId).purge([root.resourceId]);
  },
  restore: async (ctx: TrashHandlerContext, root) => {
    const topicModel = new TopicModel(ctx.db, ctx.userId, ctx.workspaceId);
    const [topic] = await topicModel.findTrashedByIds([root.resourceId]);
    if (!topic) throw new TrashRestoreError('notFound');

    // No parent-in-bin check yet: a topic's containers (agent, chat group) are
    // not trashable in this phase, so they can never be sitting in the bin.
    // The check goes in with the agent handler — see `TrashRestoreError`'s
    // `parentTrashed` code, which the client already renders.
    await topicModel.restore([root.resourceId]);
  },
  type: 'topic',
};
