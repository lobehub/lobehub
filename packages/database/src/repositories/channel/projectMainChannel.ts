import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { and, asc, eq, exists, inArray, isNull, ne, not, notExists, or } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { agents, channelMembers, channels, projects } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { notTrashed } from '../../utils/softDelete';
import { buildWorkspaceWhere } from '../../utils/workspace';
import { openChannelWhere } from './projectAccess';

const BUILTIN_SLUGS = Object.values(BUILTIN_AGENT_SLUGS) as string[];
const otherProject = alias(projects, 'other_project');

/**
 * The group Channel a person reaches a project's dedicated main Agent in: the oldest active Channel
 * of the project that Agent leads, with the Agent still seated in it, that the person belongs to or
 * may open. That is the project's General Channel unless it was archived or the Agent left it.
 *
 * Only an Agent made for its project counts: one created together with this project (or a virtual
 * coordinator from before main agents became ordinary agents), that is not a built-in assistant
 * and leads no other project. Any other Agent, such as the
 * workspace's Lobe AI or an existing Agent picked to lead a project, has a life outside the
 * project, so opening it is a direct conversation.
 *
 * Undefined when the Agent is not dedicated to a readable project, or none of its Channels qualify.
 */
export const findProjectMainChannelId = async (
  db: LobeChatDatabase,
  userId: string,
  workspaceId: string | null,
  agentId: string,
): Promise<string | undefined> => {
  const [row] = await db
    .select({ id: channels.id })
    .from(channels)
    .innerJoin(projects, eq(projects.id, channels.projectId))
    .innerJoin(agents, eq(agents.id, projects.coordinatorAgentId))
    .where(
      and(
        eq(projects.coordinatorAgentId, agentId),
        // Built-in assistants (Lobe AI and the like) are everyone's own, never one project's.
        or(isNull(agents.slug), not(inArray(agents.slug, BUILTIN_SLUGS))),
        // Created for this very project. `ProjectRepository.create` writes the main agent it makes
        // and the project in one transaction, and both take `created_at` from the database's
        // `now()`, which is fixed for a transaction. An agent made for another project, or picked
        // as an existing agent, was created at another time. Projects from before main agents
        // became ordinary agents were led by virtual coordinators instead.
        or(eq(agents.virtual, true), eq(agents.createdAt, projects.createdAt)),
        // Leading a second project makes it no single project's Agent.
        notExists(
          db
            .select({ id: otherProject.id })
            .from(otherProject)
            .where(
              and(eq(otherProject.coordinatorAgentId, agentId), ne(otherProject.id, projects.id)),
            ),
        ),
        buildWorkspaceWhere({ userId, workspaceId: workspaceId ?? undefined }, projects),
        isNull(channels.agentId),
        isNull(channels.peerUserId),
        notTrashed(channels.isDeleted),
        eq(channels.status, 'active'),
        workspaceId ? eq(channels.workspaceId, workspaceId) : isNull(channels.workspaceId),
        exists(
          db
            .select({ id: channelMembers.id })
            .from(channelMembers)
            .where(
              and(
                eq(channelMembers.channelId, channels.id),
                eq(channelMembers.actorType, 'agent'),
                eq(channelMembers.agentId, agentId),
                eq(channelMembers.status, 'active'),
              ),
            ),
        ),
        or(
          exists(
            db
              .select({ id: channelMembers.id })
              .from(channelMembers)
              .where(
                and(
                  eq(channelMembers.channelId, channels.id),
                  eq(channelMembers.actorType, 'user'),
                  eq(channelMembers.userId, userId),
                  eq(channelMembers.status, 'active'),
                ),
              ),
          ),
          openChannelWhere(db, userId, workspaceId),
        ),
      ),
    )
    .orderBy(asc(channels.createdAt), asc(channels.id))
    .limit(1);
  return row?.id;
};
