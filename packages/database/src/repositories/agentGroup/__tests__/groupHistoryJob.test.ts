// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { AgentModel } from '../../../models/agent';
import { AGENT_COPY_IN_PROGRESS, AgentCopyJobModel } from '../../../models/agentCopyJob';
import {
  AGENT_TRANSFER_IN_PROGRESS,
  AgentTransferJobModel,
} from '../../../models/agentTransferJob';
import {
  agentHistoryJobGroups,
  agentHistoryJobs,
  agents,
  chatGroups,
  chatGroupsAgents,
  messagePlugins,
  messages,
  threads,
  topics,
  users,
  workspaces,
} from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { AgentGroupRepository } from '../index';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'ghj-user';
const wsId = 'ghj-ws';
const groupId = 'ghj-group';
const supervisorId = 'ghj-supervisor';
const memberId = 'ghj-member';

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }]);
  await serverDB
    .insert(workspaces)
    .values([{ id: wsId, name: 'WS', primaryOwnerId: userId, slug: 'ghj-ws' }]);
});

afterEach(async () => {
  delete process.env.AGENT_TRANSFER_SYNC_MESSAGE_THRESHOLD;
  delete process.env.AGENT_COPY_SYNC_MESSAGE_THRESHOLD;
  await serverDB.delete(users);
  // Jobs deliberately carry no FK onto users, so clean them up explicitly.
  await serverDB.delete(agentHistoryJobs);
});

/**
 * Personal group with a supervisor + one member, two topics, a thread, four
 * group messages (one with a plugin child row, one addressed to the member
 * agent, one addressed to `'user'`) and one topicless residual message.
 */
const seedGroupWithHistory = async () => {
  await serverDB.insert(agents).values([
    { id: supervisorId, title: 'Supervisor', userId, virtual: true },
    { id: memberId, title: 'Member', userId },
  ]);
  await serverDB.insert(chatGroups).values([{ id: groupId, title: 'Team', userId }]);
  await serverDB.insert(chatGroupsAgents).values([
    { agentId: supervisorId, chatGroupId: groupId, order: -1, role: 'supervisor', userId },
    { agentId: memberId, chatGroupId: groupId, order: 0, role: 'participant', userId },
  ]);

  await serverDB.insert(topics).values([
    { agentId: supervisorId, groupId, id: 'ghj-t1', title: 't1', userId },
    { agentId: supervisorId, groupId, id: 'ghj-t2', title: 't2', userId },
  ]);
  await serverDB.insert(threads).values([
    {
      agentId: memberId,
      groupId,
      id: 'ghj-th1',
      title: 'thread',
      topicId: 'ghj-t1',
      type: 'continuation',
      userId,
    },
  ]);
  await serverDB.insert(messages).values([
    {
      agentId: supervisorId,
      content: 'hi',
      groupId,
      id: 'ghj-m1',
      role: 'user',
      targetId: 'user',
      topicId: 'ghj-t1',
      userId,
    },
    {
      agentId: memberId,
      content: 'out',
      groupId,
      id: 'ghj-m2',
      role: 'tool',
      targetId: memberId,
      topicId: 'ghj-t1',
      userId,
    },
    // topic-only row: no agent linkage, still belongs to the group's history
    { content: 'a', groupId, id: 'ghj-m3', role: 'assistant', topicId: 'ghj-t1', userId },
    {
      agentId: memberId,
      content: 'x',
      groupId,
      id: 'ghj-m4',
      role: 'user',
      topicId: 'ghj-t2',
      userId,
    },
    // residual: group-linked but topicless
    { agentId: supervisorId, content: 'r', groupId, id: 'ghj-m5', role: 'user', userId },
  ]);
  await serverDB
    .insert(messagePlugins)
    .values([{ id: 'ghj-m2', identifier: 'test-plugin', toolCallId: 'call_1', userId }]);
};

const scopeOf = async (messageId: string) => {
  const row = await serverDB.query.messages.findFirst({ where: eq(messages.id, messageId) });
  return { userId: row?.userId, workspaceId: row?.workspaceId ?? null };
};

const ALL_MESSAGE_IDS = ['ghj-m1', 'ghj-m2', 'ghj-m3', 'ghj-m4', 'ghj-m5'];

describe('group transfer fast path (small history)', () => {
  it('rewrites group messages, topic-only rows and child tables inline', async () => {
    await seedGroupWithHistory();

    const result = await new AgentGroupRepository(serverDB, userId).transferToWorkspace(
      groupId,
      wsId,
      userId,
    );
    expect(result).toEqual({ groupId, transferJobId: null });
    expect(await serverDB.query.agentHistoryJobs.findMany()).toHaveLength(0);

    for (const id of ALL_MESSAGE_IDS) {
      expect((await scopeOf(id)).workspaceId).toBe(wsId);
    }
    const plugin = await serverDB.query.messagePlugins.findFirst({
      where: eq(messagePlugins.id, 'ghj-m2'),
    });
    expect(plugin?.workspaceId).toBe(wsId);
  });
});

/**
 * `ghj-member` is a standalone agent the group only references (`virtual`
 * defaults to false), so a transfer leaves it in the source scope and takes a
 * clone instead. Everything the group said in its voice has to follow the
 * clone, or the moved transcript attributes messages to an agent the new scope
 * cannot resolve — and `messages.agent_id` is ON DELETE CASCADE, so the day
 * that agent is deleted the moved messages go with it.
 */
const clonedMemberId = async () => {
  const rows = await serverDB
    .select()
    .from(chatGroupsAgents)
    .where(eq(chatGroupsAgents.chatGroupId, groupId));
  const cloned = rows.find((row) => row.agentId !== supervisorId)!;
  return cloned.agentId;
};

const agentIdsOf = async (messageId: string) => {
  const row = await serverDB.query.messages.findFirst({ where: eq(messages.id, messageId) });
  return { agentId: row?.agentId ?? null, targetId: row?.targetId ?? null };
};

describe('group transfer member cloning', () => {
  it('leaves a referenced member behind and remaps its history onto the clone', async () => {
    await seedGroupWithHistory();

    await new AgentGroupRepository(serverDB, userId).transferToWorkspace(groupId, wsId, userId);

    const original = await serverDB.query.agents.findFirst({ where: eq(agents.id, memberId) });
    expect(original).toMatchObject({ virtual: false, workspaceId: null });

    const cloneId = await clonedMemberId();
    expect(cloneId).not.toBe(memberId);
    const clone = await serverDB.query.agents.findFirst({ where: eq(agents.id, cloneId) });
    expect(clone).toMatchObject({ title: 'Member', virtual: true, workspaceId: wsId });

    // Both the speaker and the addressee columns follow the clone.
    expect(await agentIdsOf('ghj-m2')).toEqual({ agentId: cloneId, targetId: cloneId });
    expect(await agentIdsOf('ghj-m4')).toEqual({ agentId: cloneId, targetId: null });
    // A message addressed to the human is not an agent reference.
    expect(await agentIdsOf('ghj-m1')).toEqual({ agentId: supervisorId, targetId: 'user' });

    // Threads carry the same cascade risk as messages.
    const thread = await serverDB.query.threads.findFirst({ where: eq(threads.id, 'ghj-th1') });
    expect(thread?.agentId).toBe(cloneId);
  });

  it('does not evict members from the other groups they belong to', async () => {
    await seedGroupWithHistory();
    await serverDB.insert(chatGroups).values([{ id: 'ghj-other', title: 'Other', userId }]);
    await serverDB
      .insert(chatGroupsAgents)
      .values([{ agentId: memberId, chatGroupId: 'ghj-other', order: 0, userId }]);

    await new AgentGroupRepository(serverDB, userId).transferToWorkspace(groupId, wsId, userId);

    const otherRoster = await serverDB
      .select()
      .from(chatGroupsAgents)
      .where(eq(chatGroupsAgents.chatGroupId, 'ghj-other'));
    expect(otherRoster.map((row) => row.agentId)).toEqual([memberId]);
  });
});

describe('group transfer slow path (async backfill job)', () => {
  beforeEach(() => {
    process.env.AGENT_TRANSFER_SYNC_MESSAGE_THRESHOLD = '2';
  });

  it('records a group-keyed job, defers messages, and drains topic-by-topic', async () => {
    await seedGroupWithHistory();

    const result = await new AgentGroupRepository(serverDB, userId).transferToWorkspace(
      groupId,
      wsId,
      userId,
    );
    expect(result!.transferJobId).not.toBeNull();

    // the group and its topics moved synchronously; messages did not
    const group = await serverDB.query.chatGroups.findFirst({ where: eq(chatGroups.id, groupId) });
    expect(group?.workspaceId).toBe(wsId);
    const topic = await serverDB.query.topics.findFirst({ where: eq(topics.id, 'ghj-t1') });
    expect(topic?.workspaceId).toBe(wsId);
    expect((await scopeOf('ghj-m1')).workspaceId).toBeNull();

    // the group junction is what the badge/gray-out UI looks the job up by
    const junction = await serverDB
      .select()
      .from(agentHistoryJobGroups)
      .where(eq(agentHistoryJobGroups.groupId, groupId));
    expect(junction).toHaveLength(1);

    const job = await AgentTransferJobModel.findPendingJobForGroup(serverDB, groupId);
    expect(job).toMatchObject({ completedTopics: 0, totalTopics: 2, type: 'transfer' });
    expect(await AgentTransferJobModel.getPendingTopicIds(serverDB, job!.id)).toHaveLength(2);

    await AgentTransferJobModel.drain(serverDB, result!.transferJobId!);

    for (const id of ALL_MESSAGE_IDS) {
      expect((await scopeOf(id)).workspaceId).toBe(wsId);
    }
    const plugin = await serverDB.query.messagePlugins.findFirst({
      where: eq(messagePlugins.id, 'ghj-m2'),
    });
    expect(plugin?.workspaceId).toBe(wsId);

    const [finished] = await serverDB.query.agentHistoryJobs.findMany();
    expect(finished).toMatchObject({ completedTopics: 2, status: 'completed', totalTopics: 2 });
    expect(await AgentTransferJobModel.findPendingJobForGroup(serverDB, groupId)).toBeUndefined();
  });

  it('blocks deleting a left-behind member until the remap drains', async () => {
    // `memberId` did not move, so the job does not cover it — but until the
    // drain reaches each topic, those rows still carry
    // `messages.agent_id = memberId`, and that column is ON DELETE CASCADE.
    // Deleting it here would destroy the moved history mid-rescue.
    await seedGroupWithHistory();

    const result = await new AgentGroupRepository(serverDB, userId).transferToWorkspace(
      groupId,
      wsId,
      userId,
    );

    // Not registered as a covered agent: it never moved, and the migration
    // badge reads that junction.
    expect(await AgentTransferJobModel.hasPendingJobForAgents(serverDB, [memberId])).toBe(false);
    // ...but the delete guard still sees it.
    expect(await AgentTransferJobModel.hasPendingRemapForSourceAgents(serverDB, [memberId])).toBe(
      true,
    );

    await expect(new AgentModel(serverDB, userId).delete(memberId)).rejects.toThrow(
      AGENT_TRANSFER_IN_PROGRESS,
    );

    await AgentTransferJobModel.drain(serverDB, result!.transferJobId!);

    // Once the remap has landed, the original is free again.
    expect(await AgentTransferJobModel.hasPendingRemapForSourceAgents(serverDB, [memberId])).toBe(
      false,
    );
  });

  it('defers the member remap to the drain, on exactly the rows it rewrites', async () => {
    // The remap must follow the same fast/slow split as the scope rewrite: if
    // the synchronous branch did it and the drain did not, a heavy group would
    // silently keep pointing at the agent left behind.
    await seedGroupWithHistory();

    const result = await new AgentGroupRepository(serverDB, userId).transferToWorkspace(
      groupId,
      wsId,
      userId,
    );
    const cloneId = await clonedMemberId();

    expect((await agentIdsOf('ghj-m2')).agentId).toBe(memberId);

    await AgentTransferJobModel.drain(serverDB, result!.transferJobId!);

    expect(await agentIdsOf('ghj-m2')).toEqual({ agentId: cloneId, targetId: cloneId });
    expect((await agentIdsOf('ghj-m4')).agentId).toBe(cloneId);
    // The topicless residual row is remapped by the finalization step, not by
    // any per-topic pass.
    expect((await agentIdsOf('ghj-m5')).agentId).toBe(supervisorId);
  });

  it('orders the drain by pre-transfer activity, not by transfer time', async () => {
    await seedGroupWithHistory();
    // t1 is the most recently active conversation before the move
    await serverDB
      .update(topics)
      .set({ updatedAt: new Date('2020-01-01') })
      .where(eq(topics.id, 'ghj-t2'));

    const result = await new AgentGroupRepository(serverDB, userId).transferToWorkspace(
      groupId,
      wsId,
      userId,
    );

    // The ownership UPDATE stamps every topic with the same `updatedAt`; the
    // queue must still carry the ORIGINAL activity so t1 drains first.
    const first = await AgentTransferJobModel.processNextTopic(serverDB, result!.transferJobId!);
    expect(first).toMatchObject({ done: false, topicId: 'ghj-t1' });
  });

  it('rejects a second transfer of the same group while the job is pending', async () => {
    await seedGroupWithHistory();
    const result = await new AgentGroupRepository(serverDB, userId).transferToWorkspace(
      groupId,
      wsId,
      userId,
    );

    await expect(
      new AgentGroupRepository(serverDB, userId, wsId).transferToWorkspace(groupId, null, userId),
    ).rejects.toThrow(AGENT_TRANSFER_IN_PROGRESS);

    await AgentTransferJobModel.drain(serverDB, result!.transferJobId!);
    await expect(
      new AgentGroupRepository(serverDB, userId, wsId).transferToWorkspace(groupId, null, userId),
    ).resolves.toBeTruthy();
  });

  it("leaves a member agent's own topicless messages alone, exactly like the sync path", async () => {
    await seedGroupWithHistory();
    // A member agent that is also used on its own: a topicless message linked
    // to the agent but NOT to the group. The synchronous branch rewrites the
    // residual by group only, so the slow path must not move it either —
    // otherwise a heavy group transfer moves strictly more than a small one.
    await serverDB
      .insert(messages)
      .values([{ agentId: memberId, content: 'solo', id: 'ghj-solo', role: 'user', userId }]);

    const result = await new AgentGroupRepository(serverDB, userId).transferToWorkspace(
      groupId,
      wsId,
      userId,
    );
    await AgentTransferJobModel.drain(serverDB, result!.transferJobId!);

    expect((await scopeOf('ghj-solo')).workspaceId).toBeNull();
    // ...while the group's own topicless residual did move
    expect((await scopeOf('ghj-m5')).workspaceId).toBe(wsId);
  });

  it('guards an empty-roster group, which has no member agent to match on', async () => {
    await seedGroupWithHistory();
    await serverDB.delete(chatGroupsAgents).where(eq(chatGroupsAgents.chatGroupId, groupId));

    const result = await new AgentGroupRepository(serverDB, userId).transferToWorkspace(
      groupId,
      wsId,
      userId,
    );
    expect(result!.transferJobId).not.toBeNull();

    await expect(
      new AgentGroupRepository(serverDB, userId, wsId).transferToWorkspace(groupId, null, userId),
    ).rejects.toThrow(AGENT_TRANSFER_IN_PROGRESS);
  });
});

describe('group copy fast path (small history)', () => {
  it('duplicates topics, threads and messages inline', async () => {
    await seedGroupWithHistory();

    const copied = await new AgentGroupRepository(serverDB, userId).copyToWorkspace(
      groupId,
      wsId,
      userId,
      { includeConversationHistory: true },
    );
    expect(copied!.copyJobId).toBeNull();

    const copiedMessages = await serverDB
      .select()
      .from(messages)
      .where(eq(messages.groupId, copied!.groupId));
    // the four topic-anchored rows; the topicless residual is not copied
    expect(copiedMessages).toHaveLength(4);
    expect(await serverDB.query.agentHistoryJobs.findMany()).toHaveLength(0);
  });
});

describe('group copy slow path (async copy job)', () => {
  beforeEach(() => {
    process.env.AGENT_COPY_SYNC_MESSAGE_THRESHOLD = '2';
  });

  it('creates empty topic shells, then fills them with the group remap applied', async () => {
    await seedGroupWithHistory();

    const copied = await new AgentGroupRepository(serverDB, userId).copyToWorkspace(
      groupId,
      wsId,
      userId,
      { includeConversationHistory: true },
    );
    expect(copied!.copyJobId).not.toBeNull();

    // shells exist and are usable immediately; their history is still empty
    const shells = await serverDB.select().from(topics).where(eq(topics.groupId, copied!.groupId));
    expect(shells).toHaveLength(2);
    expect(
      await serverDB.select().from(messages).where(eq(messages.groupId, copied!.groupId)),
    ).toHaveLength(0);

    // the copied group carries the badge, keyed by the NEW group
    const job = await AgentTransferJobModel.findPendingJobForGroup(serverDB, copied!.groupId);
    expect(job).toMatchObject({ totalTopics: 2, type: 'copy' });

    await AgentCopyJobModel.drain(serverDB, copied!.copyJobId!);

    const copiedMessages = await serverDB
      .select()
      .from(messages)
      .where(eq(messages.groupId, copied!.groupId));
    expect(copiedMessages).toHaveLength(4);
    // every copied row landed in the target scope
    expect(copiedMessages.every((row) => row.workspaceId === wsId)).toBe(true);

    // agent remap: the source member agent maps onto its copy, `'user'`
    // survives as the literal sentinel, and an unmapped agent becomes NULL.
    const newAgentIds = new Set(
      (await serverDB.select().from(agents).where(eq(agents.workspaceId, wsId))).map(
        (row) => row.id,
      ),
    );
    const copiedToolRow = copiedMessages.find((row) => row.role === 'tool')!;
    expect(newAgentIds.has(copiedToolRow.agentId!)).toBe(true);
    expect(copiedToolRow.agentId).not.toBe(memberId);
    expect(newAgentIds.has(copiedToolRow.targetId!)).toBe(true);
    expect(
      copiedMessages.find((row) => row.role === 'user' && row.topicId === shells[0].id),
    ).toBeDefined();
    expect(copiedMessages.some((row) => row.targetId === 'user')).toBe(true);

    // threads follow their topic onto the new group
    const copiedThreads = await serverDB
      .select()
      .from(threads)
      .where(eq(threads.groupId, copied!.groupId));
    expect(copiedThreads).toHaveLength(1);

    // the source is untouched
    for (const id of ALL_MESSAGE_IDS) {
      expect(await scopeOf(id)).toEqual({ userId, workspaceId: null });
    }
    expect(
      await AgentTransferJobModel.findPendingJobForGroup(serverDB, copied!.groupId),
    ).toBeUndefined();
  });

  it('rejects a second copy of the same source group while one is pending', async () => {
    await seedGroupWithHistory();
    const repo = new AgentGroupRepository(serverDB, userId);
    const copied = await repo.copyToWorkspace(groupId, wsId, userId, {
      includeConversationHistory: true,
    });

    await expect(
      repo.copyToWorkspace(groupId, wsId, userId, { includeConversationHistory: true }),
    ).rejects.toThrow(AGENT_COPY_IN_PROGRESS);

    // ...and blocks moving the source out from under the pending copy
    await expect(repo.transferToWorkspace(groupId, wsId, userId)).rejects.toThrow(
      AGENT_COPY_IN_PROGRESS,
    );

    await AgentCopyJobModel.drain(serverDB, copied!.copyJobId!);
    await expect(
      repo.copyToWorkspace(groupId, wsId, userId, { includeConversationHistory: true }),
    ).resolves.toBeTruthy();
  });

  it('drops a shell whose source conversation was deleted mid-copy', async () => {
    await seedGroupWithHistory();
    const copied = await new AgentGroupRepository(serverDB, userId).copyToWorkspace(
      groupId,
      wsId,
      userId,
      { includeConversationHistory: true },
    );

    await serverDB.delete(topics).where(eq(topics.id, 'ghj-t2'));
    await AgentCopyJobModel.drain(serverDB, copied!.copyJobId!);

    const shells = await serverDB.select().from(topics).where(eq(topics.groupId, copied!.groupId));
    expect(shells).toHaveLength(1);
    // progress still reaches its total instead of stalling on the missing unit
    const [finished] = await serverDB.query.agentHistoryJobs.findMany();
    expect(finished).toMatchObject({ completedTopics: 2, status: 'completed', totalTopics: 2 });
  });
});
