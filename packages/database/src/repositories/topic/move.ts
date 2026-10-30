import { and, eq, inArray, sql } from 'drizzle-orm';

import { agents, messages, threads, topics } from '../../schemas';
import { joinTopicAgentsToProjects } from '../../utils/projectTopicAgents';
import { buildWorkspaceWhere } from '../../utils/workspace';
import { messageOwnership, topicOwnership, type TopicRepositoryScope } from './scope';

/**
 * Move multiple topics (and all their messages) to another agent.
 *
 * Reassigns ownership purely through the `agentId` foreign key (the new data
 * model). Every child entity of the topic that carries its own `agentId` FK
 * MUST be updated together — `topics`, `messages`, and `threads`. Topic lists
 * query by `topics.agentId` and message queries filter by `messages.agentId`,
 * so updating only the topic would leave the moved conversation showing up
 * empty under the target agent; and `threads.agentId` is itself a
 * cascade-on-delete FK, so a thread left pointing at the source agent would
 * be destroyed if that agent is later deleted.
 *
 * `sessionId` is cleared on `topics` and `messages` so the rows fully detach
 * from the source agent's legacy session and can't leak back through the
 * sessionId-based legacy query fallback (`threads` has no `sessionId`).
 *
 * Topics can only be moved to an agent owned by the same user/workspace. The
 * target agent is verified with the same ownership predicate before applying
 * the move — `topics.agentId` / `messages.agentId` are plain FKs to
 * `agents.id` with cascade-on-delete, so attaching rows to a foreign agent
 * would both leak them across tenants and risk losing them if that agent is
 * later deleted.
 */
export const batchMoveToAgent = async (
  scope: TopicRepositoryScope,
  topicIds: string[],
  targetAgentId: string,
) => {
  if (topicIds.length === 0) return;

  return scope.db.transaction(async (tx) => {
    const [targetAgent] = await tx
      .select({ id: agents.id })
      .from(agents)
      .where(
        and(
          eq(agents.id, targetAgentId),
          buildWorkspaceWhere({ userId: scope.userId, workspaceId: scope.workspaceId }, agents),
        ),
      )
      .limit(1);

    if (!targetAgent) {
      throw new Error(`Target agent ${targetAgentId} not found or not accessible`);
    }

    const moved = await tx
      .update(topics)
      .set({ agentId: targetAgentId, sessionId: null, updatedAt: new Date() })
      .where(and(inArray(topics.id, topicIds), topicOwnership(scope)))
      .returning({ id: topics.id });
    // A project topic handed to another agent brings that agent into the project.
    await joinTopicAgentsToProjects(tx, { topicIds: moved.map((topic) => topic.id) });

    await tx
      .update(messages)
      .set({ agentId: targetAgentId, sessionId: null })
      .where(and(inArray(messages.topicId, topicIds), messageOwnership(scope)));

    await tx
      .update(threads)
      .set({
        agentId: targetAgentId,
        // Presets belong to the source agent; a no-op move keeps the attribution.
        subagentId: sql`CASE WHEN ${threads.agentId} IS DISTINCT FROM ${targetAgentId} THEN NULL ELSE ${threads.subagentId} END`,
      })
      .where(
        and(
          inArray(threads.topicId, topicIds),
          buildWorkspaceWhere({ userId: scope.userId, workspaceId: scope.workspaceId }, threads),
        ),
      );
  });
};
