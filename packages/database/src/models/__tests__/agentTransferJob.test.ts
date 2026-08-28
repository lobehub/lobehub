// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  agentHistoryJobs,
  messageGroups,
  messagePlugins,
  messages,
  topics,
  users,
  workspaces,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentModel } from '../agent';
import {
  AGENT_TRANSFER_IN_PROGRESS,
  AGENT_TRANSFER_PENDING_OWNER_DELETE,
  AgentTransferJobModel,
} from '../agentTransferJob';
import { UserModel } from '../user';
import { WorkspaceModel } from '../workspace';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'atj-test-user';
const wsId = 'atj-test-ws';

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }]);
  await serverDB
    .insert(workspaces)
    .values([{ id: wsId, name: 'WS', slug: 'atj-ws', primaryOwnerId: userId }]);
});

afterEach(async () => {
  delete process.env.AGENT_TRANSFER_SYNC_MESSAGE_THRESHOLD;
  await serverDB.delete(users);
  // Jobs deliberately carry no FK onto users (guards must observe them even
  // while an owner delete is being attempted), so clean them up explicitly.
  await serverDB.delete(agentHistoryJobs);
});

/** Agent + two topics; topic1 has 2 agent-linked messages (one with a plugin
 *  row), a topic-only message (no agentId/sessionId), and a message_group;
 *  plus one topicless agent-linked (residual) message. */
const seedAgentWithHistory = async () => {
  const model = new AgentModel(serverDB, userId);
  const agent = await model.create({ title: 'Heavy Agent' });

  await serverDB.insert(topics).values([
    { id: 'atj-t1', userId, agentId: agent.id, title: 't1' },
    { id: 'atj-t2', userId, agentId: agent.id, title: 't2' },
  ]);
  await serverDB.insert(messages).values([
    { id: 'atj-m1', userId, role: 'user', content: 'hi', agentId: agent.id, topicId: 'atj-t1' },
    { id: 'atj-m2', userId, role: 'tool', content: 'out', agentId: agent.id, topicId: 'atj-t1' },
    // topic-only row (OpenAPI create shape): no agentId, no sessionId
    { id: 'atj-m3', userId, role: 'assistant', content: 'a', topicId: 'atj-t1' },
    { id: 'atj-m4', userId, role: 'user', content: 'x', agentId: agent.id, topicId: 'atj-t2' },
    // residual: agent-linked but no topic
    { id: 'atj-m5', userId, role: 'user', content: 'r', agentId: agent.id },
  ]);
  await serverDB
    .insert(messagePlugins)
    .values([{ id: 'atj-m2', userId, toolCallId: 'call_1', identifier: 'test-plugin' }]);
  await serverDB.insert(messageGroups).values([{ id: 'atj-g1', userId, topicId: 'atj-t1' }]);

  return { agent, model };
};

const scopeOf = async (messageId: string) => {
  const row = await serverDB.query.messages.findFirst({ where: eq(messages.id, messageId) });
  return { userId: row?.userId, workspaceId: row?.workspaceId ?? null };
};

describe('transferAgents fast path (small history)', () => {
  it('rewrites messages, topic-only rows, child tables and message_groups inline', async () => {
    const { agent, model } = await seedAgentWithHistory();

    const [result] = await model.transferAgents([agent.id], wsId, userId);
    expect(result.transferJobId).toBeNull();

    // no job recorded
    const jobs = await serverDB.query.agentHistoryJobs.findMany();
    expect(jobs).toHaveLength(0);

    // every message shape moved, including topic-only and residual rows
    for (const id of ['atj-m1', 'atj-m2', 'atj-m3', 'atj-m4', 'atj-m5']) {
      expect((await scopeOf(id)).workspaceId).toBe(wsId);
    }
    // child + topic-anchored tables followed
    const plugin = await serverDB.query.messagePlugins.findFirst({
      where: eq(messagePlugins.id, 'atj-m2'),
    });
    expect(plugin?.workspaceId).toBe(wsId);
    const group = await serverDB.query.messageGroups.findFirst({
      where: eq(messageGroups.id, 'atj-g1'),
    });
    expect(group?.workspaceId).toBe(wsId);
  });
});

describe('transferAgents slow path (async backfill job)', () => {
  beforeEach(() => {
    process.env.AGENT_TRANSFER_SYNC_MESSAGE_THRESHOLD = '2';
  });

  it('records a job, leaves messages in source scope, and drains topic-by-topic', async () => {
    const { agent, model } = await seedAgentWithHistory();

    const [result] = await model.transferAgents([agent.id], wsId, userId);
    expect(result.transferJobId).not.toBeNull();

    // topics moved synchronously, messages did not
    const topic = await serverDB.query.topics.findFirst({ where: eq(topics.id, 'atj-t1') });
    expect(topic?.workspaceId).toBe(wsId);
    expect((await scopeOf('atj-m1')).workspaceId).toBeNull();

    const job = await AgentTransferJobModel.findPendingJobForAgent(serverDB, agent.id);
    expect(job).toMatchObject({ completedTopics: 0, totalTopics: 2 });
    expect(await AgentTransferJobModel.getPendingTopicIds(serverDB, job!.id)).toHaveLength(2);

    await AgentTransferJobModel.drain(serverDB, result.transferJobId!);

    // everything (incl. topic-only, residual, child, group rows) migrated
    for (const id of ['atj-m1', 'atj-m2', 'atj-m3', 'atj-m4', 'atj-m5']) {
      expect((await scopeOf(id)).workspaceId).toBe(wsId);
    }
    const plugin = await serverDB.query.messagePlugins.findFirst({
      where: eq(messagePlugins.id, 'atj-m2'),
    });
    expect(plugin?.workspaceId).toBe(wsId);
    const group = await serverDB.query.messageGroups.findFirst({
      where: eq(messageGroups.id, 'atj-g1'),
    });
    expect(group?.workspaceId).toBe(wsId);

    const [finished] = await serverDB.query.agentHistoryJobs.findMany();
    expect(finished).toMatchObject({ completedTopics: 2, status: 'completed', totalTopics: 2 });
    expect(await serverDB.query.agentHistoryJobTopics.findMany()).toHaveLength(0);
  });

  it('drains a prioritized topic first and step-resumes idempotently', async () => {
    const { agent, model } = await seedAgentWithHistory();
    // make t1 the default first pick (most recently active)
    await serverDB
      .update(topics)
      .set({ updatedAt: new Date('2026-01-01') })
      .where(eq(topics.id, 'atj-t2'));

    const [result] = await model.transferAgents([agent.id], wsId, userId);
    const jobId = result.transferJobId!;

    // user opens t2 → jump the queue
    expect(await AgentTransferJobModel.prioritizeTopic(serverDB, 'atj-t2')).toBe(true);

    const first = await AgentTransferJobModel.processNextTopic(serverDB, jobId);
    expect(first).toMatchObject({ done: false, topicId: 'atj-t2' });
    expect((await scopeOf('atj-m4')).workspaceId).toBe(wsId);
    expect((await scopeOf('atj-m1')).workspaceId).toBeNull();

    // remaining steps: t1, then the finalization call
    expect((await AgentTransferJobModel.processNextTopic(serverDB, jobId)).done).toBe(false);
    expect((await AgentTransferJobModel.processNextTopic(serverDB, jobId)).done).toBe(true);
    // an extra call on a completed job is a no-op
    expect((await AgentTransferJobModel.processNextTopic(serverDB, jobId)).done).toBe(true);

    expect((await scopeOf('atj-m5')).workspaceId).toBe(wsId);
  });

  it('rejects a second transfer and owner deletes while the job is pending', async () => {
    const { agent, model } = await seedAgentWithHistory();
    const [result] = await model.transferAgents([agent.id], wsId, userId);
    expect(result.transferJobId).not.toBeNull();

    const wsModel = new AgentModel(serverDB, userId, wsId);
    await expect(wsModel.transferAgents([agent.id], null, userId)).rejects.toThrow(
      AGENT_TRANSFER_IN_PROGRESS,
    );
    await expect(UserModel.deleteUser(serverDB, userId)).rejects.toThrow(
      AGENT_TRANSFER_PENDING_OWNER_DELETE,
    );
    await expect(new WorkspaceModel(serverDB, userId).delete(wsId)).rejects.toThrow(
      AGENT_TRANSFER_PENDING_OWNER_DELETE,
    );

    // once drained, both operations unblock
    await AgentTransferJobModel.drain(serverDB, result.transferJobId!);
    await expect(
      new AgentModel(serverDB, userId, wsId).transferAgents([agent.id], null, userId),
    ).resolves.toBeTruthy();
  });

  it('round-trips personal → workspace → personal with consistent data', async () => {
    const { agent, model } = await seedAgentWithHistory();
    const [out] = await model.transferAgents([agent.id], wsId, userId);
    await AgentTransferJobModel.drain(serverDB, out.transferJobId!);

    const wsModel = new AgentModel(serverDB, userId, wsId);
    const [back] = await wsModel.transferAgents([agent.id], null, userId);
    if (back.transferJobId) await AgentTransferJobModel.drain(serverDB, back.transferJobId);

    for (const id of ['atj-m1', 'atj-m2', 'atj-m3', 'atj-m4', 'atj-m5']) {
      expect(await scopeOf(id)).toEqual({ userId, workspaceId: null });
    }
    const jobsAfter = await serverDB
      .select()
      .from(agentHistoryJobs)
      .where(eq(agentHistoryJobs.status, 'pending'));
    expect(jobsAfter).toHaveLength(0);
  });
});
