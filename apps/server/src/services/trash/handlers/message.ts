import { AgentModel } from '@/database/models/agent';
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

export const MESSAGE_TITLE_LENGTH = 120;

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
    projectId: row.projectId,
    resourceId: row.id,
    resourceType: 'message',
    title: row.content?.trim().slice(0, MESSAGE_TITLE_LENGTH) || null,
  });

  const roots = rows.filter((row) => !row.isCompanion);
  const companions = rows.filter((row) => row.isCompanion);
  return roots.map((root) => ({
    // Companions go under the assistant turn whose tool call produced them:
    // roots are restored and purged independently, so filing them under any
    // other root would strand or destroy them out of step with their turn.
    children: companions.filter((row) => row.ownerId === root.id).map(entry),
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

    // The parent message must be live too: when an ancestor and its descendant
    // are trashed in one batch, the descendant keeps pointing at the ancestor,
    // so restoring it first would leave a branch hanging off a hidden row.
    if (message.parentId) {
      const [parent] = await messageModel.findTrashedByIds([message.parentId]);
      if (parent) throw new TrashRestoreError('parentTrashed');
    }

    // The topic the message lives in must itself be live.
    if (message.topicId) {
      const topicModel = new TopicModel(ctx.db, ctx.userId, ctx.workspaceId);
      const [topic] = await topicModel.findTrashedByIds([message.topicId]);
      if (topic) throw new TrashRestoreError('parentTrashed');
    }

    // Nor may its owning agent be in the bin (topic-less rows have no topic
    // check to fall back on).
    const agentModel = new AgentModel(ctx.db, ctx.userId, ctx.workspaceId);
    if (await agentModel.hasTrashedOwner(message)) throw new TrashRestoreError('parentTrashed');

    const entries = [root, ...children.filter((c) => c.resourceType === 'message')].map((row) => ({
      childIds: row.meta?.messageTree?.childIds,
      id: row.resourceId,
      parentId: row.meta?.messageTree?.parentId,
    }));
    // Same purge race as the topic handler: only a root this write actually
    // brought back is a successful restore.
    const restored = await messageModel.restoreMessages(entries);
    if (!restored.includes(root.resourceId)) throw new TrashRestoreError('notFound');
  },
  type: 'message',
};
