import { agentDisplayName } from '@lobechat/types';
import { chunk } from 'es-toolkit/compat';

import { AgentModel } from '@/database/models/agent';
import { MessageModel } from '@/database/models/message';
import { ResourcePermissionModel } from '@/database/models/resourcePermission';
import { SessionModel } from '@/database/models/session';
import { TopicModel } from '@/database/models/topic';
import { TrashModel } from '@/database/models/trash';
import type { AgentItem } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import type { SoftDeleteOptions } from '@/database/utils/softDelete';

import { MESSAGE_TITLE_LENGTH } from './message';
import { hasWaitingWorktreeCleanup, topicEntry, WORKTREE_CLEANUP_WAITING_MESSAGE } from './topic';
import {
  type TrashCascade,
  type TrashHandler,
  type TrashHandlerContext,
  TrashPurgeBlockedError,
  TrashRestoreError,
} from './types';

/** Ids per purge statement — well under Postgres' bind-parameter cap. */
const PURGE_CHUNK_SIZE = 1000;

export const agentEntry = (agent: AgentItem, childCount: number) => ({
  meta: {
    avatar: agent.avatar,
    backgroundColor: agent.backgroundColor,
    childCount,
  },
  projectId: null,
  resourceId: agent.id,
  resourceType: 'agent' as const,
  // Label the entry the way the sidebar does: `name` first, `title` (the
  // agent's role) only when it has no name.
  title: agentDisplayName(agent) ?? null,
});

/**
 * Trash an agent with its conversation history: every topic with its
 * `agent_id`, plus its topic-less messages (no topic stamp hides those). Both
 * are registered as children so a restore brings the whole history back in
 * one go. Rows carrying only a legacy `session_id` are not part of the cascade.
 */
export const softDeleteAgent = async (
  ctx: TrashHandlerContext,
  agentId: string,
  options: SoftDeleteOptions,
): Promise<TrashCascade | null> => {
  const agentModel = new AgentModel(ctx.db, ctx.userId, ctx.workspaceId);
  const topicModel = new TopicModel(ctx.db, ctx.userId, ctx.workspaceId);

  // Same pre-flight as the hard delete: never pull an agent out from under a
  // history copy / transfer that is still running.
  await agentModel.assertDeletable([agentId]);

  const [agent] = await agentModel.softDelete([agentId], options);
  if (!agent) return null;

  // The cascade is scope-wide on purpose (no `restrictToCreator`): the router
  // only lets a non-owner through when nothing foreign rides along, or when
  // the agent's author (or an Admin overriding on another member's agent)
  // acknowledged that teammates' topics go with it.
  const topics = await topicModel.softDeleteByParents(
    { agentIds: [agentId] },
    { deletedAt: options.deletedAt },
  );
  const topiclessMessages = await new MessageModel(
    ctx.db,
    ctx.userId,
    ctx.workspaceId,
  ).softDeleteTopicless({ agentIds: [agentId] }, { deletedAt: options.deletedAt });

  return {
    children: [
      ...topics.map((topic) => topicEntry(topic)),
      ...topiclessMessages.map((message) => ({
        meta: { role: message.role },
        projectId: null,
        resourceId: message.id,
        resourceType: 'message' as const,
        title: message.content?.trim().slice(0, MESSAGE_TITLE_LENGTH) || null,
      })),
    ],
    root: agentEntry(agent, topics.length + topiclessMessages.length),
  };
};

export const agentHandler: TrashHandler = {
  /**
   * One transaction across the agent, its legacy session shells, stale
   * descendant roots and its sharing grants: a failure leaves the whole unit
   * in place for the next retry, and a restore that won the race (nothing
   * left stamped) keeps all of it.
   */
  purge: async (ctx, root) => {
    await ctx.db.transaction(async (tx) => {
      const db = tx as unknown as LobeChatDatabase;
      const agentModel = new AgentModel(db, ctx.userId, ctx.workspaceId);

      const agentIds = await agentModel.lockTrashedForPurge([root.resourceId]);
      if (agentIds.length === 0) return;
      const topicModel = new TopicModel(db, ctx.userId, ctx.workspaceId);
      const trashModel = new TrashModel(db, ctx.userId, ctx.workspaceId);
      const sessionIds = await agentModel.findSessionIdsByAgentIds(agentIds);
      // Bin entries from before the cascade went agent-only can list rows that
      // only carry `session_id`. The FK below no longer reaches those.
      const stranded = await trashModel.findChildrenOutsideAgents(root.id, agentIds);

      // The cascade below takes the agent's topics with it — including the
      // only record of a worktree cleanup still waiting on an offline device.
      // Hold the whole purge until those have run (see `./topic`).
      const waiting = await topicModel.findWaitingCleanupTopicsUnder({
        agentIds,
        topicIds: stranded.topicIds,
      });
      if (hasWaitingWorktreeCleanup(waiting))
        throw new TrashPurgeBlockedError(WORKTREE_CLEANUP_WAITING_MESSAGE);

      // Topics outside the cascade keep their messages and threads. Runs before
      // the root cleanup so a message trashed on its own there keeps its entry.
      await agentModel.detachFromSurvivingTopics(agentIds);
      // Topics / messages trashed on their own before this agent keep separate
      // roots; the deletes below remove them, so drop those rows first.
      await trashModel.removeRootsUnderAgents({ agentIds, topicIds: stranded.topicIds });
      await topicModel.purge(stranded.topicIds);
      // FK cascades take the topics / messages / threads carrying the agent.
      await agentModel.purge(agentIds);
      const messageModel = new MessageModel(db, ctx.userId, ctx.workspaceId);
      for (const ids of chunk(stranded.messageIds, PURGE_CHUNK_SIZE)) {
        await messageModel.purgeMessages(ids);
      }
      await new SessionModel(db, ctx.userId, ctx.workspaceId).deleteEmptyShellsByIds(sessionIds);
      if (ctx.workspaceId) {
        await new ResourcePermissionModel(db, ctx.workspaceId).removeAll('agent', root.resourceId);
      }
    });
  },
  restore: async (ctx, root, children) => {
    const agentModel = new AgentModel(ctx.db, ctx.userId, ctx.workspaceId);
    const [restored] = await agentModel.restore([root.resourceId]);
    if (!restored) throw new TrashRestoreError('notFound');

    const topicIds = children.filter((c) => c.resourceType === 'topic').map((c) => c.resourceId);
    await new TopicModel(ctx.db, ctx.userId, ctx.workspaceId).restore(topicIds);

    const messageIds = children.filter((c) => c.resourceType === 'message');
    await new MessageModel(ctx.db, ctx.userId, ctx.workspaceId).restoreMessages(
      messageIds.map((c) => ({ id: c.resourceId })),
    );
  },
  type: 'agent',
};
