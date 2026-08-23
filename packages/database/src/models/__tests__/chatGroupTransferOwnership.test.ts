// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  agents,
  agentsKnowledgeBases,
  chatGroups,
  chatGroupsAgents,
  knowledgeBases,
  topics,
  users,
  workspaces,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AGENT_TRANSFER_IN_PROGRESS, AgentTransferJobModel } from '../agentTransferJob';
import {
  CHAT_GROUP_OWNERSHIP_STALE,
  CHAT_GROUP_TRANSFER_HIDDEN_MEMBER,
  ChatGroupModel,
} from '../chatGroup';

const serverDB: LobeChatDatabase = await getTestDB();

const ownerId = 'group-handover-owner';
const recipientId = 'group-handover-recipient';
const teammateId = 'group-handover-teammate';
const wsId = 'group-handover-ws';

const ownerModel = new ChatGroupModel(serverDB, ownerId, wsId);
const recipientModel = new ChatGroupModel(serverDB, recipientId, wsId);

const handover = (params: Parameters<ChatGroupModel['transferGroupOwnership']>[1]) =>
  serverDB.transaction(async (trx) => recipientModel.transferGroupOwnership(trx, params));

/** A group with a virtual supervisor (owned) and a standalone teammate agent (referenced). */
const seedGroupWithRoster = async () => {
  const group = await ownerModel.create({ title: 'Handover Group', visibility: 'public' });
  const [supervisor] = await serverDB
    .insert(agents)
    .values({ title: 'Supervisor', userId: ownerId, virtual: true, workspaceId: wsId })
    .returning();
  const [referenced] = await serverDB
    .insert(agents)
    .values({ title: 'Standalone', userId: teammateId, virtual: false, workspaceId: wsId })
    .returning();
  await serverDB.insert(chatGroupsAgents).values([
    {
      agentId: supervisor.id,
      chatGroupId: group.id,
      role: 'supervisor',
      userId: ownerId,
      workspaceId: wsId,
    },
    {
      agentId: referenced.id,
      chatGroupId: group.id,
      role: 'participant',
      userId: ownerId,
      workspaceId: wsId,
    },
  ]);
  return { group, referenced, supervisor };
};

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: ownerId }, { id: recipientId }, { id: teammateId }]);
  await serverDB.insert(workspaces).values([
    {
      id: wsId,
      name: 'Group Handover WS',
      primaryOwnerId: ownerId,
      slug: 'group-handover-ws',
    },
  ]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('ChatGroupModel.transferGroupOwnership', () => {
  it('flips the group, junction rows and owned members; scope and visibility stay put', async () => {
    const { group, supervisor } = await seedGroupWithRoster();

    await handover({ fromUserId: ownerId, groupId: group.id, toUserId: recipientId });

    const [updated] = await serverDB.select().from(chatGroups).where(eq(chatGroups.id, group.id));
    expect(updated.userId).toBe(recipientId);
    expect(updated.workspaceId).toBe(wsId);
    expect(updated.visibility).toBe('public');

    const junctionRows = await serverDB
      .select()
      .from(chatGroupsAgents)
      .where(eq(chatGroupsAgents.chatGroupId, group.id));
    expect(junctionRows).toHaveLength(2);
    for (const row of junctionRows) expect(row.userId).toBe(recipientId);

    const [ownedAgent] = await serverDB.select().from(agents).where(eq(agents.id, supervisor.id));
    expect(ownedAgent.userId).toBe(recipientId);
    expect(ownedAgent.workspaceId).toBe(wsId);
  });

  it('leaves referenced standalone members with their own owners', async () => {
    const { group, referenced } = await seedGroupWithRoster();

    await handover({ fromUserId: ownerId, groupId: group.id, toUserId: recipientId });

    const [standalone] = await serverDB.select().from(agents).where(eq(agents.id, referenced.id));
    expect(standalone.userId).toBe(teammateId);
  });

  it('keeps everyone’s group conversations untouched', async () => {
    const { group } = await seedGroupWithRoster();
    await serverDB.insert(topics).values([
      { groupId: group.id, id: 'grp-owner-topic', userId: ownerId, workspaceId: wsId },
      { groupId: group.id, id: 'grp-teammate-topic', userId: teammateId, workspaceId: wsId },
    ]);

    await handover({ fromUserId: ownerId, groupId: group.id, toUserId: recipientId });

    const rows = await serverDB.select().from(topics);
    expect(rows.find((t) => t.id === 'grp-owner-topic')?.userId).toBe(ownerId);
    expect(rows.find((t) => t.id === 'grp-teammate-topic')?.userId).toBe(teammateId);
  });

  it('detaches owned members’ knowledge mounts the recipient cannot access', async () => {
    const { group, supervisor } = await seedGroupWithRoster();
    await serverDB.insert(knowledgeBases).values([
      {
        id: 'gkb-owner-private',
        name: 'A',
        userId: ownerId,
        visibility: 'private',
        workspaceId: wsId,
      },
      { id: 'gkb-public', name: 'B', userId: ownerId, visibility: 'public', workspaceId: wsId },
    ]);
    await serverDB.insert(agentsKnowledgeBases).values(
      ['gkb-owner-private', 'gkb-public'].map((knowledgeBaseId) => ({
        agentId: supervisor.id,
        knowledgeBaseId,
        userId: ownerId,
        workspaceId: wsId,
      })),
    );

    await handover({ fromUserId: ownerId, groupId: group.id, toUserId: recipientId });

    // Same policy as the single-agent handover: the previous owner's PRIVATE
    // KB is unreachable for the new owner — the mount goes; the public one
    // stays, re-homed to the recipient so it no longer cascades away with the
    // previous owner's account.
    const mounts = await serverDB
      .select({ id: agentsKnowledgeBases.knowledgeBaseId, userId: agentsKnowledgeBases.userId })
      .from(agentsKnowledgeBases)
      .where(eq(agentsKnowledgeBases.agentId, supervisor.id));
    expect(mounts).toEqual([{ id: 'gkb-public', userId: recipientId }]);
  });

  it('refuses handover when a referenced member is private to someone else', async () => {
    const { group, referenced } = await seedGroupWithRoster();
    await serverDB
      .update(agents)
      .set({ visibility: 'private' })
      .where(eq(agents.id, referenced.id));

    await expect(
      handover({ fromUserId: ownerId, groupId: group.id, toUserId: recipientId }),
    ).rejects.toThrow(CHAT_GROUP_TRANSFER_HIDDEN_MEMBER);

    // Nothing moved.
    const [groupRow] = await serverDB.select().from(chatGroups).where(eq(chatGroups.id, group.id));
    expect(groupRow.userId).toBe(ownerId);
  });

  it('rejects a stale request when the owner already changed', async () => {
    const { group } = await seedGroupWithRoster();
    await serverDB
      .update(chatGroups)
      .set({ userId: teammateId })
      .where(eq(chatGroups.id, group.id));

    await expect(
      handover({ fromUserId: ownerId, groupId: group.id, toUserId: recipientId }),
    ).rejects.toThrow(CHAT_GROUP_OWNERSHIP_STALE);
  });

  it('rejects when the group is no longer in the workspace', async () => {
    const personalModel = new ChatGroupModel(serverDB, ownerId);
    const group = await personalModel.create({ title: 'Personal Group' });

    await expect(
      handover({ fromUserId: ownerId, groupId: group.id, toUserId: recipientId }),
    ).rejects.toThrow(CHAT_GROUP_OWNERSHIP_STALE);
  });

  it('refuses while a backfill job still covers the group', async () => {
    const { group } = await seedGroupWithRoster();
    await AgentTransferJobModel.createJob(serverDB, {
      agentIds: [],
      groupIds: [group.id],
      residualAgentIds: [],
      sessionIds: [],
      source: { userId: ownerId, workspaceId: wsId },
      target: { userId: teammateId, workspaceId: null },
      topics: [],
    });

    await expect(
      handover({ fromUserId: ownerId, groupId: group.id, toUserId: recipientId }),
    ).rejects.toThrow(AGENT_TRANSFER_IN_PROGRESS);
  });
});
