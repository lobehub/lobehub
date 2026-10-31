// @vitest-environment node
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import {
  agents as agentsTable,
  chatGroups,
  chatGroupsAgents,
  users,
  workspaces,
} from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { AgentGroupRepository } from '../index';

const userId = 'group-deletion-user';
const otherUserId = 'group-deletion-other-user';
const workspaceId = 'group-deletion-workspace';

const serverDB: LobeChatDatabase = await getTestDB();
const repo = new AgentGroupRepository(serverDB, userId);

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB.insert(workspaces).values({
    id: workspaceId,
    name: 'Group Deletion Workspace',
    primaryOwnerId: userId,
    slug: workspaceId,
  });
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('AgentGroupRepository.deleteGroup', () => {
  it('should delete group-owned member agents and keep referenced ones', async () => {
    await serverDB.transaction(async (trx) => {
      await trx
        .insert(chatGroups)
        .values({ id: 'owned-cleanup-group', title: 'Owned Cleanup', userId });

      await trx.insert(agentsTable).values([
        // Group-built members: the supervisor plus a virtual member. Neither
        // has any existence outside this group.
        { id: 'owned-supervisor', title: 'Supervisor', userId, virtual: true },
        { id: 'owned-member', title: 'Owned Member', userId, virtual: true },
        // Someone's own agent, merely linked in.
        { id: 'referenced-member', title: 'Referenced Member', userId, virtual: false },
      ]);

      await trx.insert(chatGroupsAgents).values([
        {
          agentId: 'owned-supervisor',
          chatGroupId: 'owned-cleanup-group',
          role: 'supervisor',
          userId,
        },
        {
          agentId: 'owned-member',
          chatGroupId: 'owned-cleanup-group',
          userId,
        },
        {
          agentId: 'referenced-member',
          chatGroupId: 'owned-cleanup-group',
          userId,
        },
      ]);
    });

    const result = await repo.deleteGroup('owned-cleanup-group');

    expect(result.deletedOwnedAgentIds.sort()).toEqual(['owned-member', 'owned-supervisor']);

    const survivors = await serverDB
      .select({ id: agentsTable.id })
      .from(agentsTable)
      .where(inArray(agentsTable.id, ['owned-supervisor', 'owned-member', 'referenced-member']));
    expect(survivors).toEqual([{ id: 'referenced-member' }]);
  });

  it('should classify members by agents.virtual', async () => {
    // `agents.virtual` is the whole judgement: it is the only thing keeping
    // this delete from either leaking or over-deleting.
    await serverDB.transaction(async (trx) => {
      await trx
        .insert(chatGroups)
        .values({ id: 'legacy-cleanup-group', title: 'Legacy Cleanup', userId });

      await trx.insert(agentsTable).values([
        { id: 'legacy-virtual', title: 'Legacy Virtual', userId, virtual: true },
        { id: 'legacy-real', title: 'Legacy Real', userId, virtual: false },
      ]);

      await trx.insert(chatGroupsAgents).values([
        { agentId: 'legacy-virtual', chatGroupId: 'legacy-cleanup-group', userId },
        { agentId: 'legacy-real', chatGroupId: 'legacy-cleanup-group', userId },
      ]);
    });

    const result = await repo.deleteGroup('legacy-cleanup-group');

    expect(result.deletedOwnedAgentIds).toEqual(['legacy-virtual']);

    const survivors = await serverDB
      .select({ id: agentsTable.id })
      .from(agentsTable)
      .where(inArray(agentsTable.id, ['legacy-virtual', 'legacy-real']));
    expect(survivors).toEqual([{ id: 'legacy-real' }]);
  });

  it('should clean up an owned member another workspace user made private', async () => {
    // The previous service-level cleanup read the roster through a
    // visibility-scoped query, so this member was invisible to the deleter
    // and leaked every time.
    const wsRepo = new AgentGroupRepository(serverDB, userId, workspaceId);

    await serverDB.transaction(async (trx) => {
      await trx.insert(chatGroups).values({
        id: 'ws-cleanup-group',
        title: 'Workspace Cleanup',
        userId,
        workspaceId,
      });

      await trx.insert(agentsTable).values({
        id: 'ws-private-owned',
        title: 'Private Owned',
        userId: otherUserId,
        virtual: true,
        visibility: 'private',
        workspaceId,
      });

      await trx.insert(chatGroupsAgents).values({
        agentId: 'ws-private-owned',
        chatGroupId: 'ws-cleanup-group',
        userId: otherUserId,
        workspaceId,
      });
    });

    const result = await wsRepo.deleteGroup('ws-cleanup-group');

    expect(result.deletedOwnedAgentIds).toEqual(['ws-private-owned']);
    const survivors = await serverDB
      .select({ id: agentsTable.id })
      .from(agentsTable)
      .where(eq(agentsTable.id, 'ws-private-owned'));
    expect(survivors).toEqual([]);
  });

  it('should never delete a builtin agent that ended up on a roster', async () => {
    // `owned` should be enough on its own; the slug guard is the backstop for
    // a malformed row, and losing someone's Inbox to a group delete is not a
    // failure mode worth leaving to one predicate.
    await serverDB.transaction(async (trx) => {
      await trx
        .insert(chatGroups)
        .values({ id: 'builtin-cleanup-group', title: 'Builtin Cleanup', userId });

      await trx.insert(agentsTable).values({
        id: 'builtin-inbox',
        slug: 'inbox',
        title: 'Inbox',
        userId,
        virtual: true,
      });

      await trx.insert(chatGroupsAgents).values({
        agentId: 'builtin-inbox',
        chatGroupId: 'builtin-cleanup-group',
        userId,
      });
    });

    const result = await repo.deleteGroup('builtin-cleanup-group');

    expect(result.deletedOwnedAgentIds).toEqual([]);
    const survivors = await serverDB
      .select({ id: agentsTable.id })
      .from(agentsTable)
      .where(eq(agentsTable.id, 'builtin-inbox'));
    expect(survivors).toEqual([{ id: 'builtin-inbox' }]);
  });

  it('should roll back the owned-agent cleanup when the group is not in scope', async () => {
    await serverDB.transaction(async (trx) => {
      await trx
        .insert(chatGroups)
        .values({ id: 'foreign-cleanup-group', title: 'Foreign', userId: otherUserId });
      await trx.insert(agentsTable).values({
        id: 'foreign-owned',
        title: 'Foreign Owned',
        userId: otherUserId,
        virtual: true,
      });
      await trx.insert(chatGroupsAgents).values({
        agentId: 'foreign-owned',
        chatGroupId: 'foreign-cleanup-group',
        userId: otherUserId,
      });
    });

    await expect(repo.deleteGroup('foreign-cleanup-group')).rejects.toThrow(
      'Chat group not found or access denied',
    );

    const survivors = await serverDB
      .select({ id: agentsTable.id })
      .from(agentsTable)
      .where(eq(agentsTable.id, 'foreign-owned'));
    expect(survivors).toEqual([{ id: 'foreign-owned' }]);
  });
});

describe('AgentGroupRepository.deleteAllGroups', () => {
  it('should delete every group in scope with its owned agents only', async () => {
    await serverDB.transaction(async (trx) => {
      await trx.insert(chatGroups).values([
        { id: 'all-group-1', title: 'Group 1', userId },
        { id: 'all-group-2', title: 'Group 2', userId },
        { id: 'all-other-group', title: 'Other Group', userId: otherUserId },
      ]);
      await trx.insert(agentsTable).values([
        { id: 'all-owned-1', title: 'Owned 1', userId, virtual: true },
        { id: 'all-referenced', title: 'Referenced', userId, virtual: false },
        { id: 'all-other-owned', title: 'Other Owned', userId: otherUserId, virtual: true },
      ]);
      await trx.insert(chatGroupsAgents).values([
        { agentId: 'all-owned-1', chatGroupId: 'all-group-1', userId },
        { agentId: 'all-referenced', chatGroupId: 'all-group-2', userId },
        { agentId: 'all-other-owned', chatGroupId: 'all-other-group', userId: otherUserId },
      ]);
    });

    await repo.deleteAllGroups();

    const remainingGroups = await serverDB.select({ id: chatGroups.id }).from(chatGroups);
    expect(remainingGroups).toEqual([{ id: 'all-other-group' }]);

    const survivors = await serverDB
      .select({ id: agentsTable.id })
      .from(agentsTable)
      .where(inArray(agentsTable.id, ['all-owned-1', 'all-referenced', 'all-other-owned']));
    expect(survivors.map(({ id }) => id).sort()).toEqual(['all-other-owned', 'all-referenced']);
  });
});
