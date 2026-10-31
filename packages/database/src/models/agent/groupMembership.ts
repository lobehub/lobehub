import { and, eq, inArray, sql } from 'drizzle-orm';

import { agents, chatGroups, chatGroupsAgents } from '../../schemas';
import type { LobeChatDatabase, Transaction } from '../../type';
import { resolveGroupMembershipType } from '../../utils/groupMembership';
import { buildWorkspaceWhere } from '../../utils/workspace';
import { type AgentModelContext } from './context';
import { type AgentGroupMembershipRef } from './types';

/**
 * Chat-group memberships of the given agents, split by who owns the
 * membership.
 *
 * Read from the RAW junction rows: whether an agent may move is a fact about
 * the data, not about what the caller happens to see, and a group hidden
 * from them would otherwise silently drop out of the guard. Only the TITLE is
 * gated on visibility — a private group's name is its members' business —
 * which is why `groupTitle` is nullable.
 */
export const queryGroupMemberships = async (
  ctx: AgentModelContext,
  executor: Transaction | LobeChatDatabase,
  agentIds: string[],
): Promise<{ blocked: AgentGroupMembershipRef[]; leaving: AgentGroupMembershipRef[] }> => {
  if (agentIds.length === 0) return { blocked: [], leaving: [] };

  const rows = await executor
    .select({
      agentId: chatGroupsAgents.agentId,
      avatar: chatGroups.avatar,
      backgroundColor: chatGroups.backgroundColor,
      groupId: chatGroups.id,
      role: chatGroupsAgents.role,
      slug: agents.slug,
      title: chatGroups.title,
      virtual: agents.virtual,
      visible: sql<boolean>`(${buildWorkspaceWhere(
        { userId: ctx.userId, workspaceId: ctx.workspaceId },
        {
          isDeleted: chatGroups.isDeleted,
          userId: chatGroups.userId,
          visibility: chatGroups.visibility,
          workspaceId: chatGroups.workspaceId,
        },
      )})`,
    })
    .from(chatGroupsAgents)
    .innerJoin(chatGroups, eq(chatGroupsAgents.chatGroupId, chatGroups.id))
    .innerJoin(agents, eq(chatGroupsAgents.agentId, agents.id))
    .where(inArray(chatGroupsAgents.agentId, agentIds));

  const blocked: AgentGroupMembershipRef[] = [];
  const leaving: AgentGroupMembershipRef[] = [];

  for (const row of rows) {
    // Identity is withheld as a unit: a hidden group leaks neither its name
    // nor its avatar. The membership itself still counts toward the guard.
    const ref: AgentGroupMembershipRef = {
      agentId: row.agentId,
      groupAvatar: row.visible ? row.avatar : null,
      groupBackgroundColor: row.visible ? row.backgroundColor : null,
      // Withheld as a unit — id included. This is the one place these refs
      // are built, so the transfer error's `groups` payload is covered too.
      groupId: row.visible ? row.groupId : null,
      groupTitle: row.visible ? row.title : null,
      groupVisible: !!row.visible,
    };

    if (resolveGroupMembershipType(row) === 'owned') blocked.push(ref);
    else leaving.push(ref);
  }

  return { blocked, leaving };
};

export const findOwnedGroupMemberships = async (
  ctx: AgentModelContext,
  executor: Transaction | LobeChatDatabase,
  agentIds: string[],
): Promise<AgentGroupMembershipRef[]> =>
  (await queryGroupMemberships(ctx, executor, agentIds)).blocked;

/**
 * What moving these agents would do to the chat groups they are in, asked
 * BEFORE the move so the UI can block or confirm.
 *
 * `blocked` refuses the transfer outright (see the guard in
 * {@link transferAgents}); `leaving` is the silent side effect the user is
 * entitled to see first — a transfer drops every group link the agent holds,
 * and until now did so without a word.
 *
 * Reports only on agents the caller can already see, so the endpoint cannot
 * be used to probe which groups an arbitrary agent id sits in. The scoping
 * lives HERE rather than in the router because {@link queryGroupMemberships}
 * is deliberately unscoped — the transfer guard has to see a membership even
 * in a group hidden from the caller — and that difference is too easy to
 * lose track of one call site away.
 */
export const getGroupMembershipImpact = async (
  ctx: AgentModelContext,
  agentIds: string[],
): Promise<{ blocked: AgentGroupMembershipRef[]; leaving: AgentGroupMembershipRef[] }> => {
  const uniqueIds = [...new Set(agentIds)];
  if (uniqueIds.length === 0) return { blocked: [], leaving: [] };

  // One query for the whole batch: the endpoint accepts up to 100 ids, and a
  // visibility probe per id is 100 round trips for a modal that opens on a
  // click.
  const visibleRows = await ctx.db
    .select({ id: agents.id })
    .from(agents)
    .where(and(inArray(agents.id, uniqueIds), ctx.ownership()));

  return queryGroupMemberships(
    ctx,
    ctx.db,
    visibleRows.map((row) => row.id),
  );
};
