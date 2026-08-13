// @vitest-environment node
import { and, eq, isNull } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  agentHistoryJobs,
  agentHistoryJobTopics,
  agents,
  messagePlugins,
  messages,
  threads,
  topics,
  users,
  workspaces,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { idGenerator } from '../../utils/idGenerator';
import { AGENT_COPY_IN_PROGRESS, AgentCopyJobModel } from '../agentCopyJob';
import { processNextAgentHistoryJobTopic } from '../agentHistoryJob';
import { AgentTransferJobModel } from '../agentTransferJob';
import { UserModel } from '../user';
import { WorkspaceModel } from '../workspace';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'acj-test-user';
const wsId = 'acj-test-ws';

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }]);
  await serverDB
    .insert(workspaces)
    .values([{ id: wsId, name: 'WS', slug: 'acj-ws', primaryOwnerId: userId }]);
});

afterEach(async () => {
  await serverDB.delete(users);
  // Jobs deliberately carry no FK onto users; clean them up explicitly.
  await serverDB.delete(agentHistoryJobs);
});

/**
 * Personal source agent with two topics. Topic t1 carries a parent-linked
 * message pair (assistant one with a tools array + plugin row) and a thread
 * anchored on the user message; t2 has a single message.
 */
const seedSourceAgent = async () => {
  const [agent] = await serverDB
    .insert(agents)
    .values({ title: 'Source Agent', userId })
    .returning();

  await serverDB.insert(topics).values([
    { agentId: agent.id, id: 'acj-t1', title: 't1', userId },
    { agentId: agent.id, id: 'acj-t2', title: 't2', userId },
  ]);
  await serverDB.insert(threads).values([
    {
      agentId: agent.id,
      id: 'acj-th1',
      sourceMessageId: 'acj-m1',
      topicId: 'acj-t1',
      type: 'continuation',
      userId,
    },
  ]);
  await serverDB.insert(messages).values([
    { agentId: agent.id, content: 'hi', id: 'acj-m1', role: 'user', topicId: 'acj-t1', userId },
    {
      agentId: agent.id,
      content: 'out',
      id: 'acj-m2',
      parentId: 'acj-m1',
      role: 'tool',
      threadId: 'acj-th1',
      tools: [{ id: 'toolu_src', type: 'builtin' }],
      topicId: 'acj-t1',
      userId,
    },
    { agentId: agent.id, content: 'x', id: 'acj-m3', role: 'user', topicId: 'acj-t2', userId },
  ]);
  await serverDB
    .insert(messagePlugins)
    .values([{ id: 'acj-m2', identifier: 'test-plugin', toolCallId: 'toolu_src', userId }]);

  return agent;
};

/**
 * The synchronous half a copy caller performs before recording the job:
 * target agent + target topic shells in the target scope.
 */
const seedTargetShells = async (sourceAgentId: string) => {
  const [newAgent] = await serverDB
    .insert(agents)
    .values({ title: 'Copied Agent', userId, workspaceId: wsId })
    .returning();

  const topicPairs: [string, string][] = [
    ['acj-t1', idGenerator('topics')],
    ['acj-t2', idGenerator('topics')],
  ];
  await serverDB.insert(topics).values(
    topicPairs.map(([sourceTopicId, newTopicId]) => ({
      agentId: newAgent.id,
      id: newTopicId,
      title: sourceTopicId,
      userId,
      workspaceId: wsId,
    })),
  );

  const jobId = await AgentCopyJobModel.createJob(serverDB, {
    agents: [{ newAgentId: newAgent.id, sourceAgentId }],
    source: { userId, workspaceId: null },
    target: { userId, workspaceId: wsId },
    topics: topicPairs.map(([sourceTopicId, newTopicId], index) => ({
      activityAt: new Date(2026, 0, index + 1),
      newAgentId: newAgent.id,
      newTopicId,
      sourceAgentId,
      sourceTopicId,
    })),
  });

  return { jobId, newAgent, topicPairs };
};

describe('AgentCopyJobModel', () => {
  it('drains topic-by-topic, duplicating threads and messages into the shells', async () => {
    const source = await seedSourceAgent();
    const { jobId, newAgent, topicPairs } = await seedTargetShells(source.id);
    const newTopicIds = new Map(topicPairs);

    await AgentCopyJobModel.drain(serverDB, jobId);

    // t1: both messages landed in the new scope under the new topic/agent
    const copiedT1 = await serverDB.query.messages.findMany({
      where: eq(messages.topicId, newTopicIds.get('acj-t1')!),
    });
    expect(copiedT1).toHaveLength(2);
    for (const row of copiedT1) {
      expect(row.agentId).toBe(newAgent.id);
      expect(row.userId).toBe(userId);
      expect(row.workspaceId).toBe(wsId);
      expect(['acj-m1', 'acj-m2']).not.toContain(row.id);
    }
    // parent chain remapped, not dangling
    const copiedChild = copiedT1.find((row) => row.role === 'tool')!;
    const copiedParent = copiedT1.find((row) => row.role === 'user')!;
    expect(copiedChild.parentId).toBe(copiedParent.id);

    // thread duplicated with remapped topic/sourceMessage anchors
    const copiedThreads = await serverDB.query.threads.findMany({
      where: eq(threads.topicId, newTopicIds.get('acj-t1')!),
    });
    expect(copiedThreads).toHaveLength(1);
    expect(copiedThreads[0].sourceMessageId).toBe(copiedParent.id);
    expect(copiedThreads[0].agentId).toBe(newAgent.id);
    expect(copiedChild.threadId).toBe(copiedThreads[0].id);

    // plugin row followed its message and kept the tools[].id linkage
    const copiedPlugin = await serverDB.query.messagePlugins.findFirst({
      where: eq(messagePlugins.id, copiedChild.id),
    });
    expect(copiedPlugin?.workspaceId).toBe(wsId);
    const copiedTools = copiedChild.tools as { id: string }[];
    expect(copiedPlugin?.toolCallId).toBe(copiedTools[0].id);
    expect(copiedTools[0].id).not.toBe('toolu_src');

    // t2 copied as well; source rows untouched in the personal scope
    expect(
      await serverDB.query.messages.findMany({
        where: eq(messages.topicId, newTopicIds.get('acj-t2')!),
      }),
    ).toHaveLength(1);
    const sourceRows = await serverDB.query.messages.findMany({
      where: and(eq(messages.agentId, source.id), isNull(messages.workspaceId)),
    });
    expect(sourceRows).toHaveLength(3);

    // job finalized, queue empty
    const [job] = await serverDB.query.agentHistoryJobs.findMany();
    expect(job).toMatchObject({
      completedTopics: 2,
      status: 'completed',
      totalTopics: 2,
      type: 'copy',
    });
    expect(await serverDB.query.agentHistoryJobTopics.findMany()).toHaveLength(0);
  });

  it('drops the target shell when its source topic is deleted mid-copy', async () => {
    const source = await seedSourceAgent();
    const { jobId, topicPairs } = await seedTargetShells(source.id);
    const newTopicIds = new Map(topicPairs);

    // the user deletes one conversation while the copy is still queued
    await serverDB.delete(topics).where(eq(topics.id, 'acj-t1'));

    await AgentCopyJobModel.drain(serverDB, jobId);

    // the shell that can never be filled is gone, not left empty
    expect(
      await serverDB.query.topics.findFirst({
        where: eq(topics.id, newTopicIds.get('acj-t1')!),
      }),
    ).toBeUndefined();
    // the surviving topic copied normally
    expect(
      await serverDB.query.messages.findMany({
        where: eq(messages.topicId, newTopicIds.get('acj-t2')!),
      }),
    ).toHaveLength(1);

    // the unit still counts as done, so progress reaches its total
    const [job] = await serverDB.query.agentHistoryJobs.findMany();
    expect(job).toMatchObject({ completedTopics: 2, status: 'completed', totalTopics: 2 });
    expect(await serverDB.query.agentHistoryJobTopics.findMany()).toHaveLength(0);
  });

  it('keeps a target shell that already holds messages', async () => {
    const source = await seedSourceAgent();
    const { jobId, newAgent, topicPairs } = await seedTargetShells(source.id);
    const newTopicIds = new Map(topicPairs);
    const shellId = newTopicIds.get('acj-t1')!;

    // content written into the shell is real user data — never collateral of
    // the source deletion
    await serverDB.insert(messages).values({
      agentId: newAgent.id,
      content: 'typed by the user',
      id: 'acj-target-msg',
      role: 'user',
      topicId: shellId,
      userId,
      workspaceId: wsId,
    });
    await serverDB.delete(topics).where(eq(topics.id, 'acj-t1'));

    await AgentCopyJobModel.drain(serverDB, jobId);

    expect(await serverDB.query.topics.findFirst({ where: eq(topics.id, shellId) })).toBeDefined();
    expect(
      await serverDB.query.messages.findFirst({ where: eq(messages.id, 'acj-target-msg') }),
    ).toBeDefined();

    // and the job still converges instead of wedging on the kept shell
    const [job] = await serverDB.query.agentHistoryJobs.findMany();
    expect(job).toMatchObject({ completedTopics: 2, status: 'completed', totalTopics: 2 });
    expect(await serverDB.query.agentHistoryJobTopics.findMany()).toHaveLength(0);
  });

  it('keeps a target shell holding only a thread', async () => {
    const source = await seedSourceAgent();
    const { jobId, newAgent, topicPairs } = await seedTargetShells(source.id);
    const shellId = new Map(topicPairs).get('acj-t1')!;

    // deleting the topic cascades to threads too, so they gate the delete
    await serverDB.insert(threads).values({
      agentId: newAgent.id,
      id: 'acj-target-thread',
      topicId: shellId,
      type: 'standalone',
      userId,
      workspaceId: wsId,
    });
    await serverDB.delete(topics).where(eq(topics.id, 'acj-t1'));

    await AgentCopyJobModel.drain(serverDB, jobId);

    expect(await serverDB.query.topics.findFirst({ where: eq(topics.id, shellId) })).toBeDefined();
    expect(
      await serverDB.query.threads.findFirst({ where: eq(threads.id, 'acj-target-thread') }),
    ).toBeDefined();
  });

  it('picks a prioritized topic first and finalizes exactly once', async () => {
    const source = await seedSourceAgent();
    const { jobId, topicPairs } = await seedTargetShells(source.id);
    const newTopicIds = new Map(topicPairs);

    // default order would pick t2 (higher activityAt); the user opens new-t1
    await serverDB
      .update(agentHistoryJobTopics)
      .set({ priority: true })
      .where(eq(agentHistoryJobTopics.topicId, newTopicIds.get('acj-t1')!));

    const first = await AgentCopyJobModel.processNextTopic(serverDB, jobId);
    expect(first).toMatchObject({ done: false, topicId: newTopicIds.get('acj-t1') });

    expect((await AgentCopyJobModel.processNextTopic(serverDB, jobId)).done).toBe(false);
    expect((await AgentCopyJobModel.processNextTopic(serverDB, jobId)).done).toBe(true);
    // extra call on a completed job is a no-op — the copy is not re-run
    expect((await AgentCopyJobModel.processNextTopic(serverDB, jobId)).done).toBe(true);
    expect(
      await serverDB.query.messages.findMany({
        where: eq(messages.topicId, newTopicIds.get('acj-t1')!),
      }),
    ).toHaveLength(2);
  });

  it('guards a pending source agent and clears after the drain', async () => {
    const source = await seedSourceAgent();
    const { jobId } = await seedTargetShells(source.id);

    expect(
      await AgentCopyJobModel.hasPendingCopyJobForSourceAgents(serverDB, [source.id], userId),
    ).toBe(true);
    expect(
      await AgentCopyJobModel.hasPendingCopyJobForSourceAgents(serverDB, ['other-agent'], userId),
    ).toBe(false);
    // Without an initiator id the guard scans all pending copy jobs — the form
    // used by transfer/delete guards, where the mutator may be a different
    // workspace member than the copy's initiator.
    expect(await AgentCopyJobModel.hasPendingCopyJobForSourceAgents(serverDB, [source.id])).toBe(
      true,
    );

    await AgentCopyJobModel.drain(serverDB, jobId);

    expect(
      await AgentCopyJobModel.hasPendingCopyJobForSourceAgents(serverDB, [source.id], userId),
    ).toBe(false);
  });

  it('blocks transferring or deleting a source agent while its copy is pending', async () => {
    const { AgentModel } = await import('../agent');
    const source = await seedSourceAgent();
    await seedTargetShells(source.id);

    const agentModel = new AgentModel(serverDB, userId);
    await expect(agentModel.transferAgents([source.id], wsId, userId)).rejects.toThrow(
      AGENT_COPY_IN_PROGRESS,
    );
    await expect(agentModel.delete(source.id)).rejects.toThrow(AGENT_COPY_IN_PROGRESS);
  });

  // LOBE-12922: copy sits on the ordinary user path, so a pending copy job
  // must never wedge an owner's workspace/account deletion the way a pending
  // transfer does — the cloud delete flows cancel Stripe and wipe the billing
  // rows BEFORE they reach these guards.
  it('does not block deleting the target workspace, and self-heals the job', async () => {
    const source = await seedSourceAgent();
    const { jobId, topicPairs } = await seedTargetShells(source.id);

    expect(await AgentTransferJobModel.hasPendingJobTouchingWorkspace(serverDB, wsId)).toBe(false);
    await expect(new WorkspaceModel(serverDB, userId).delete(wsId)).resolves.toBeDefined();

    // the target topics cascaded away with the workspace, taking the queue
    // rows with them, so the next drain simply finalizes the job
    expect(await serverDB.query.agentHistoryJobTopics.findMany()).toHaveLength(0);
    await AgentCopyJobModel.drain(serverDB, jobId);
    const [job] = await serverDB.query.agentHistoryJobs.findMany();
    expect(job).toMatchObject({ status: 'completed', type: 'copy' });

    // source history is untouched — a copy never moved it in the first place
    const newTopicIds = new Map(topicPairs);
    expect(
      await serverDB.query.messages.findMany({
        where: and(eq(messages.agentId, source.id), isNull(messages.workspaceId)),
      }),
    ).toHaveLength(3);
    expect(
      await serverDB.query.topics.findFirst({
        where: eq(topics.id, newTopicIds.get('acj-t1')!),
      }),
    ).toBeUndefined();
  });

  it('does not block deleting the owner account', async () => {
    const source = await seedSourceAgent();
    await seedTargetShells(source.id);

    expect(await AgentTransferJobModel.hasPendingJobTouchingUser(serverDB, userId)).toBe(false);
    await expect(UserModel.deleteUser(serverDB, userId)).resolves.toBeDefined();
    expect(await serverDB.query.users.findFirst({ where: eq(users.id, userId) })).toBeUndefined();
  });

  // LOBE-12935: a copy drives the SAME migration UI as a transfer (progress
  // badge, topic gray-out, open-to-prioritize) and shares the same crash-
  // recovery net. Every query behind those must stay type-agnostic; only the
  // owner-delete guards (LOBE-12922) and the per-type drains filter by type.
  it('stays visible to the shared migration queries while pending', async () => {
    const source = await seedSourceAgent();
    const { jobId, newAgent, topicPairs } = await seedTargetShells(source.id);
    const shellId = new Map(topicPairs).get('acj-t1')!;

    // progress badge + the `type` the client words its hints by
    const progress = await AgentTransferJobModel.findPendingJobForAgent(serverDB, newAgent.id);
    expect(progress).toMatchObject({ id: jobId, totalTopics: 2, type: 'copy' });

    // gray-out set and open-to-prioritize on a queued shell
    expect(await AgentTransferJobModel.getPendingTopicIds(serverDB, jobId)).toHaveLength(2);
    expect(await AgentTransferJobModel.findPendingJobForTopic(serverDB, shellId)).toEqual({
      jobId,
    });
    expect(await AgentTransferJobModel.prioritizeTopic(serverDB, shellId)).toBe(true);

    // crash-recovery net must re-arm copy jobs too
    expect(await AgentTransferJobModel.listPendingJobIds(serverDB)).toContain(jobId);

    // and a concurrent transfer of the copy's TARGET agent stays blocked: the
    // drain would keep writing into the scope the transfer just moved away
    expect(await AgentTransferJobModel.hasPendingJobForAgents(serverDB, [newAgent.id])).toBe(true);
  });

  it('is not drained by the transfer driver', async () => {
    const source = await seedSourceAgent();
    const { jobId } = await seedTargetShells(source.id);

    // running transfer logic here would rewrite the shells' scope and delete
    // their queue rows while copying nothing
    expect(await AgentTransferJobModel.processNextTopic(serverDB, jobId)).toEqual({ done: true });

    expect(await serverDB.query.agentHistoryJobTopics.findMany()).toHaveLength(2);
    const [job] = await serverDB.query.agentHistoryJobs.findMany();
    expect(job).toMatchObject({ completedTopics: 0, status: 'pending' });
  });

  it('routes copy jobs through the type dispatcher', async () => {
    const source = await seedSourceAgent();
    const { jobId, topicPairs } = await seedTargetShells(source.id);
    const newTopicIds = new Map(topicPairs);

    let steps = 0;
    while (!(await processNextAgentHistoryJobTopic(serverDB, jobId)).done) steps += 1;
    expect(steps).toBe(2);
    expect(
      await serverDB.query.messages.findMany({
        where: eq(messages.topicId, newTopicIds.get('acj-t2')!),
      }),
    ).toHaveLength(1);
  });
});
