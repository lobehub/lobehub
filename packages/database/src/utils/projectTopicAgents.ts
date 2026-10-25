import { INBOX_SESSION_ID } from '@lobechat/const';
import { and, eq, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';

import { agents } from '../schemas/agent';
import { projectAgents, projects } from '../schemas/project';
import { topics } from '../schemas/topic';
import type { LobeChatDatabase, Transaction } from '../type';

export type ProjectTopicAgentsFilter = { projectId: string } | { topicIds: string[] };

/**
 * An agent that works on a project topic is a member of that project: add the
 * agent of every matching topic to its project's members. Existing members keep
 * their role, responsibility and enabled state.
 *
 * The coordinator is managed by the project, and a shared workspace project only
 * takes shared agents, so neither ever joins this way. A project whose main
 * agent was cleared is led by LobeAI (see `resolveCoordinatorAgents`), so LobeAI
 * counts as its coordinator here.
 *
 * Best effort: membership is a side effect of the topic write, so a failure is
 * logged instead of failing it. The work runs in its own savepoint, so a failed
 * statement does not abort the caller's transaction either.
 */
export const joinTopicAgentsToProjects = async (
  db: LobeChatDatabase | Transaction,
  filter: ProjectTopicAgentsFilter,
) => {
  if ('topicIds' in filter && filter.topicIds.length === 0) return;

  try {
    await db.transaction(async (tx) => {
      const candidates = await tx
        .selectDistinct({
          agentId: agents.id,
          projectId: projects.id,
          workspaceId: projects.workspaceId,
        })
        .from(topics)
        .innerJoin(projects, eq(projects.id, topics.projectId))
        .innerJoin(agents, eq(agents.id, topics.agentId))
        .where(
          and(
            'topicIds' in filter
              ? inArray(topics.id, filter.topicIds)
              : eq(topics.projectId, filter.projectId),
            isNotNull(topics.agentId),
            isNull(topics.deletedAt),
            or(
              and(
                isNotNull(projects.coordinatorAgentId),
                ne(agents.id, projects.coordinatorAgentId),
              ),
              and(
                isNull(projects.coordinatorAgentId),
                sql`${agents.slug} is distinct from ${INBOX_SESSION_ID}`,
              ),
            ),
            sql`${agents.workspaceId} is not distinct from ${projects.workspaceId}`,
            or(
              isNull(projects.workspaceId),
              ne(projects.visibility, 'public'),
              eq(agents.visibility, 'public'),
            ),
          ),
        );
      if (candidates.length === 0) return;

      await tx
        .insert(projectAgents)
        .values(candidates)
        .onConflictDoNothing({ target: [projectAgents.projectId, projectAgents.agentId] });
    });
  } catch (error) {
    console.error('[joinTopicAgentsToProjects] failed to add topic agents to projects', error);
  }
};
