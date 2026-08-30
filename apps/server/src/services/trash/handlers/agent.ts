import { AgentModel } from '@/database/models/agent';
import { ResourcePermissionModel } from '@/database/models/resourcePermission';
import { TopicModel } from '@/database/models/topic';
import type { AgentItem } from '@/database/schemas';
import type { SoftDeleteOptions } from '@/database/utils/softDelete';

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
  resourceId: agent.id,
  resourceType: 'agent' as const,
  title: agent.title,
});

/**
 * Trash an agent with everything the hard delete would cascade through: every
 * topic that hangs off it directly (`agent_id`) or through its legacy session
 * shell (`session_id`). Topics are registered as children so a restore brings
 * the whole conversation history back in one go.
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

  return {
    children: topics.map((topic) => topicEntry(topic)),
    root: agentEntry(agent, topics.length),
  };
};

export const agentHandler: TrashHandler = {
  purge: async (ctx, root) => {
    // FK cascades take topics / messages / threads with the agent + session rows.
    await new AgentModel(ctx.db, ctx.userId, ctx.workspaceId).purge([root.resourceId]);
    if (ctx.workspaceId) {
      await new ResourcePermissionModel(ctx.db, ctx.workspaceId).removeAll(
        'agent',
        root.resourceId,
      );
    }
  },
  restore: async (ctx, root, children) => {
    const agentModel = new AgentModel(ctx.db, ctx.userId, ctx.workspaceId);
    const [restored] = await agentModel.restore([root.resourceId]);
    if (!restored) throw new TrashRestoreError('notFound');

    const topicIds = children.filter((c) => c.resourceType === 'topic').map((c) => c.resourceId);
    await new TopicModel(ctx.db, ctx.userId, ctx.workspaceId).restore(topicIds);
  },
  type: 'agent',
};
