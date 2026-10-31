import { and, eq, inArray } from 'drizzle-orm';

import type { ChatGroupItem } from '../../schemas';
import { agents, chatGroups, chatGroupsAgents } from '../../schemas';
import { isOwnedMembership } from '../../utils/groupMembership';
import { type ChatGroupContext, groupOwnership } from './scope';

/**
 * Agent ids that die with the given groups.
 *
 * `agents` has NO foreign key to `chat_groups` — the cascade only reaches the
 * junction — so deleting a group leaves its synthetic supervisor and its
 * group-built members behind forever: `virtual: true` hides them from every
 * list, so nothing will ever surface or reclaim them.
 *
 * Read from the RAW junction rows, with no visibility or ownership predicate
 * on the member agent. Those predicates belong to reads: a member another
 * workspace user flipped back to `private` is still owned by this group, and
 * filtering it out here is precisely how the previous service-level cleanup
 * leaked. The caller has already proven it may delete the group itself.
 *
 * Must be read BEFORE the group delete: the junction rows cascade away with
 * the group, taking the only record of which agents were group-owned.
 */
export const findOwnedMemberAgentIds = async (
  ctx: ChatGroupContext,
  groupIds: string[],
): Promise<string[]> => {
  if (groupIds.length === 0) return [];

  const rows = await ctx.db
    .select({ agentId: chatGroupsAgents.agentId })
    .from(chatGroupsAgents)
    .innerJoin(agents, eq(chatGroupsAgents.agentId, agents.id))
    .where(and(inArray(chatGroupsAgents.chatGroupId, groupIds), isOwnedMembership()));

  return [...new Set(rows.map((row) => row.agentId))];
};

export const findGroupIdsInScope = async (ctx: ChatGroupContext): Promise<string[]> => {
  const rows = await ctx.db
    .select({ id: chatGroups.id })
    .from(chatGroups)
    .where(groupOwnership(ctx));

  return rows.map((row) => row.id);
};

/** Delete one group row; its junction rows cascade. Throws when not in scope. */
export const deleteGroup = async (ctx: ChatGroupContext, id: string): Promise<ChatGroupItem> => {
  const [result] = await ctx.db
    .delete(chatGroups)
    .where(and(eq(chatGroups.id, id), groupOwnership(ctx)))
    .returning();

  if (!result) {
    throw new Error('Chat group not found or access denied');
  }

  return result;
};

export const deleteAllGroups = async (ctx: ChatGroupContext): Promise<void> => {
  await ctx.db.delete(chatGroups).where(groupOwnership(ctx));
};
