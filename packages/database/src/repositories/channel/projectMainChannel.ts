import { and, asc, eq, exists, isNull, or } from 'drizzle-orm';

import { channelMembers, channels, projects } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { notTrashed } from '../../utils/softDelete';
import { buildWorkspaceWhere } from '../../utils/workspace';
import { openChannelWhere } from './projectAccess';

/**
 * The group Channel a person reaches a project's main Agent in: the oldest active Channel of a
 * project that Agent leads, with the Agent still seated in it, that the person belongs to or may
 * open. That is the project's General Channel unless it was archived or the Agent left it.
 * Undefined when the Agent leads no readable project, or none of its Channels qualify.
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
    .where(
      and(
        eq(projects.coordinatorAgentId, agentId),
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
