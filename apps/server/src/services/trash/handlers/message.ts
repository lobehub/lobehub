import { MessageModel } from '@/database/models/message';
import { TopicModel } from '@/database/models/topic';
import type { TrashRegisterEntry } from '@/database/models/trash';
import type { SoftDeleteOptions } from '@/database/utils/softDelete';

import {
  type TrashCascade,
  type TrashHandler,
  type TrashHandlerContext,
  TrashRestoreError,
} from './types';

const TITLE_LENGTH = 120;

/**
 * Trash messages. Each requested message is its own root; the tool-result
 * companions pulled in with an assistant turn are registered as its children.
 * The tree data needed to splice a message back is kept in `meta.messageTree`.
 */
export const softDeleteMessages = async (
  ctx: TrashHandlerContext,
  ids: string[],
  options: SoftDeleteOptions,
): Promise<TrashCascade[]> => {
  const rows = await new MessageModel(ctx.db, ctx.userId, ctx.workspaceId).softDeleteMessages(
    ids,
    options,
  );
  const entry = (row: (typeof rows)[number]): TrashRegisterEntry => ({
    meta: {
      messageTree: { childIds: row.childIds, parentId: row.parentId },
      parentTitle: row.topicId,
      role: row.role,
    },
    resourceId: row.id,
    resourceType: 'message',
    title: row.content?.trim().slice(0, TITLE_LENGTH) || null,
  });

  const roots = rows.filter((row) => !row.isCompanion);
  const companions = rows.filter((row) => row.isCompanion);
  return roots.map((root, index) => ({
    // Companions of an assistant turn belong to it; with several roots in one
    // batch we can't tell whose companion is whose from the rows alone, so
    // attach them all to the first root — restore / purge treat the batch as
    // one unit either way.
    children: index === 0 ? companions.map(entry) : [],
    root: entry(root),
  }));
};

export const messageHandler: TrashHandler = {
  purge: async (ctx, root, children) => {
    await new MessageModel(ctx.db, ctx.userId, ctx.workspaceId).purgeMessages([
      root.resourceId,
      ...children.filter((c) => c.resourceType === 'message').map((c) => c.resourceId),
    ]);
  },
  restore: async (ctx, root, children) => {
    const messageModel = new MessageModel(ctx.db, ctx.userId, ctx.workspaceId);
    const [message] = await messageModel.findTrashedByIds([root.resourceId]);
    if (!message) throw new TrashRestoreError('notFound');

    // The topic the message lives in must itself be live.
    if (message.topicId) {
      const topicModel = new TopicModel(ctx.db, ctx.userId, ctx.workspaceId);
      const [topic] = await topicModel.findTrashedByIds([message.topicId]);
      if (topic) throw new TrashRestoreError('parentTrashed');
    }

    const entries = [root, ...children.filter((c) => c.resourceType === 'message')].map((row) => ({
      childIds: row.meta?.messageTree?.childIds,
      id: row.resourceId,
      parentId: row.meta?.messageTree?.parentId,
    }));
    await messageModel.restoreMessages(entries);
  },
  type: 'message',
};
