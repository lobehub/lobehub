import type { ChannelMemberRole } from '@lobechat/types';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';

import { channelMembers, channels, workspaceMembers } from '../../schemas';

/** Workspace roles that manage every group Channel they belong to in that workspace. */
const WORKSPACE_MANAGER_ROLES = ['owner', 'admin'];

/**
 * The caller's role as permission checks see it. A workspace owner or admin counts at least as
 * an admin of the group Channels they belong to in that workspace; direct and peer
 * conversations stay with their participants. The stored member row keeps its own role.
 */
export const callerRole = (userId: string, workspaceId: string | null) => {
  if (!workspaceId) return sql<ChannelMemberRole | null>`${channelMembers.role}`;
  return sql<ChannelMemberRole | null>`CASE
    WHEN ${channelMembers.role} = 'owner' THEN ${channelMembers.role}
    WHEN ${channels.agentId} IS NULL AND ${channels.peerUserId} IS NULL AND EXISTS (
      SELECT 1 FROM ${workspaceMembers}
      WHERE ${workspaceMembers.workspaceId} = ${channels.workspaceId}
        AND ${workspaceMembers.userId} = ${userId}
        AND ${workspaceMembers.deletedAt} IS NULL
        AND ${inArray(workspaceMembers.role, WORKSPACE_MANAGER_ROLES)}
    ) THEN 'admin'
    ELSE ${channelMembers.role}
  END`;
};

/** The caller's own active membership row, in the current personal or workspace scope. */
export const membershipWhere = (userId: string, workspaceId: string | null) =>
  and(
    eq(channelMembers.actorType, 'user'),
    eq(channelMembers.userId, userId),
    eq(channelMembers.status, 'active'),
    or(isNull(channels.agentId), eq(channels.userId, userId)),
    workspaceId ? eq(channels.workspaceId, workspaceId) : isNull(channels.workspaceId),
  );
