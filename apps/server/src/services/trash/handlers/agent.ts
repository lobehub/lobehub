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
import { topicEntry } from './topic';
import {
  type TrashCascade,
  type TrashHandler,
  type TrashHandlerContext,
  TrashRestoreError,
} from './types';

export const agentEntry = (agent: AgentItem, childCount: number) => ({
  meta: {
    avatar: agent.avatar,
    backgroundColor: agent.backgroundColor,
    childCount,
  },
  projectId: null,
  resourceId: agent.id,
  resourceType: 'agent' as const,
  title: agent.title,
});

/**
 * Trash an agent with everything the hard delete would cascade through: every
 * topic that hangs off it directly (`agent_id`) or through its legacy session
 * shell (`session_id`), plus the topic-less messages under either (no topic
 * stamp hides those). Both are registered as children so a restore brings the
 * whole conversation history back in one go.
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

  // Legacy session shells are not stamped (the agent is the restorable unit
  // and the list hides them through the agent join); their topics are.
  const sessionIds = await agentModel.findSessionIdsByAgentIds([agentId]);
  // The cascade is scope-wide on purpose (no `restrictToCreator`): the router
  // already refused a non-owner delete of an agent that carries teammates'
  // conversations, so whatever is left is the caller's to take.
  const topics = await topicModel.softDeleteByParents(
    { agentIds: [agentId], sessionIds },
    { deletedAt: options.deletedAt },
  );
  const topiclessMessages = await new MessageModel(
    ctx.db,
    ctx.userId,
    ctx.workspaceId,
  ).softDeleteTopicless({ agentIds: [agentId], sessionIds }, { deletedAt: options.deletedAt });

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
      const sessionIds = await agentModel.findSessionIdsByAgentIds(agentIds);

      // Topics / messages trashed on their own before this agent keep separate
      // roots; the cascade below deletes them, so drop those rows first.
      await new TrashModel(db, ctx.userId, ctx.workspaceId).removeRootsUnderAgents({
        agentIds,
        sessionIds,
      });
      // FK cascades take topics / messages / threads with the agent + session rows.
      await agentModel.purge(agentIds);
      await new SessionModel(db, ctx.userId, ctx.workspaceId).deleteShellsByIds(sessionIds);
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
