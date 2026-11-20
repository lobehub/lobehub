import { and, eq, inArray, isNull, notInArray, or } from 'drizzle-orm';

import { ChatGroupModel } from '../../models/chatGroup';
import { RESERVED_BUILTIN_AGENT_SLUGS } from '../../models/chatGroup/constants';
import type { ChatGroupItem } from '../../schemas';
import { agents } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import type { AgentGroupScope } from './scope';

/**
 * Builtin agents (Inbox, the agent builders, …) are provisioned per user and
 * are `virtual` like a group's own members, so `owned` on a malformed
 * junction row would be enough to take one down with a group. Their reserved
 * slugs are the one thing that always tells them apart — a cheap belt to the
 * `owned` braces, on a delete whose blast radius is somebody's Inbox.
 */
const deleteOwnedMemberAgents = async (
  executor: LobeChatDatabase,
  agentIds: string[],
): Promise<string[]> => {
  if (agentIds.length === 0) return [];

  const deleted = await executor
    .delete(agents)
    .where(
      and(
        inArray(agents.id, agentIds),
        eq(agents.virtual, true),
        // A NULL slug predates slug generation and is not a builtin;
        // `NOT IN` alone would evaluate to NULL and skip those rows.
        or(isNull(agents.slug), notInArray(agents.slug, RESERVED_BUILTIN_AGENT_SLUGS)),
      ),
    )
    .returning({ id: agents.id });

  return deleted.map((row) => row.id);
};

/**
 * Delete a group together with the agents that only existed to serve it.
 * The group (chat-group aggregate) and its owned member agents (agent
 * aggregate) go in one transaction: a cleanup that can be interrupted between
 * the two statements is a leak with extra steps.
 *
 * Returns the deleted owned-agent ids so callers can report them; the delete
 * itself needs no follow-up.
 */
export const deleteGroupWithOwnedAgents = async (
  scope: AgentGroupScope,
  id: string,
): Promise<{ deletedOwnedAgentIds: string[]; group: ChatGroupItem }> =>
  scope.db.transaction(async (trx) => {
    const groupModel = new ChatGroupModel(trx as LobeChatDatabase, scope.userId, scope.workspaceId);
    // Collect BEFORE the delete: the junction rows cascade away with the
    // group, taking the only record of which agents were group-owned.
    const ownedAgentIds = await groupModel.findOwnedMemberAgentIds([id]);
    const group = await groupModel.delete(id);
    const deletedOwnedAgentIds = await deleteOwnedMemberAgents(
      trx as LobeChatDatabase,
      ownedAgentIds,
    );

    return { deletedOwnedAgentIds, group };
  });

/** Delete every group in scope together with the agents they own. */
export const deleteAllGroupsWithOwnedAgents = async (scope: AgentGroupScope): Promise<void> => {
  await scope.db.transaction(async (trx) => {
    const groupModel = new ChatGroupModel(trx as LobeChatDatabase, scope.userId, scope.workspaceId);
    const groupIds = await groupModel.findIdsInScope();
    const ownedAgentIds = await groupModel.findOwnedMemberAgentIds(groupIds);

    await groupModel.deleteAll();
    await deleteOwnedMemberAgents(trx as LobeChatDatabase, ownedAgentIds);
  });
};
