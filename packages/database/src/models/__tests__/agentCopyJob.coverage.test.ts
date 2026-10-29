// @vitest-environment node
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  agentHistoryJobs,
  agentHistoryJobTopics,
  agents,
  chatGroups,
  messages,
  threads,
  topics,
  users,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { INSERT_BATCH_SIZE } from '../../utils/batchInsert';
import { AgentCopyJobModel } from '../agentCopyJob';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'acj-cov-user';
const scope = { userId, workspaceId: null };

beforeEach(async () => {
  await serverDB.insert(users).values({ id: userId });
});

afterEach(async () => {
  // Jobs carry no FK onto users; remove them explicitly before the user cascade.
  await serverDB.delete(agentHistoryJobs).where(eq(agentHistoryJobs.sourceUserId, userId));
  await serverDB.delete(users).where(inArray(users.id, [userId]));
});

const threadsOf = (topicId: string) =>
  serverDB.query.threads.findMany({ where: eq(threads.topicId, topicId) });

const jobOf = (jobId: string) =>
  serverDB.query.agentHistoryJobs.findFirst({ where: eq(agentHistoryJobs.id, jobId) });

/**
 * Source topic `<prefix>-src` whose threads exercise every remap edge: a root thread, a child of
 * it, a child of a thread in ANOTHER topic (its parent is not copied), and a thread anchored on a
 * message from another topic (its anchor is not copied). `<prefix>-elsewhere` holds those two
 * out-of-topic references.
 */
const seedRemapEdges = async (
  prefix: string,
  owner: { agentId?: string; groupId?: string },
  threadAgentIds: { child: null | string; root: null | string },
) => {
  await serverDB.insert(topics).values([
    { ...owner, id: `${prefix}-src`, userId },
    { ...owner, id: `${prefix}-elsewhere`, userId },
  ]);
  await serverDB.insert(messages).values([
    { content: 'in', id: `${prefix}-m-in`, role: 'user', topicId: `${prefix}-src`, userId },
    { content: 'out', id: `${prefix}-m-out`, role: 'user', topicId: `${prefix}-elsewhere`, userId },
  ]);
  const base = { groupId: owner.groupId, type: 'continuation' as const, userId };
  await serverDB.insert(threads).values([
    { ...base, agentId: owner.agentId, id: `${prefix}-th-far`, topicId: `${prefix}-elsewhere` },
    {
      ...base,
      agentId: threadAgentIds.root,
      id: `${prefix}-th-root`,
      sourceMessageId: `${prefix}-m-in`,
      title: 'root',
      topicId: `${prefix}-src`,
    },
  ]);
  await serverDB.insert(threads).values([
    {
      ...base,
      agentId: threadAgentIds.child,
      id: `${prefix}-th-child`,
      parentThreadId: `${prefix}-th-root`,
      title: 'child',
      topicId: `${prefix}-src`,
    },
    {
      ...base,
      agentId: threadAgentIds.child,
      id: `${prefix}-th-orphan`,
      parentThreadId: `${prefix}-th-far`,
      sourceMessageId: `${prefix}-m-out`,
      title: 'orphan',
      topicId: `${prefix}-src`,
    },
  ]);
};

/** Index copied threads by title and check every out-of-topic reference collapsed to null. */
const expectRemappedThreads = async (newTopicId: string) => {
  const list = await threadsOf(newTopicId);
  const copied: Record<string, (typeof list)[number]> = Object.fromEntries(
    list.map((t) => [t.title, t]),
  );
  expect(Object.keys(copied).sort()).toEqual(['child', 'orphan', 'root']);
  const [copiedMessage] = await serverDB.query.messages.findMany({
    where: eq(messages.topicId, newTopicId),
  });

  expect(copied.root.parentThreadId).toBeNull();
  expect(copied.root.sourceMessageId).toBe(copiedMessage.id);
  expect(copied.child.parentThreadId).toBe(copied.root.id);
  expect(copied.child.sourceMessageId).toBeNull();
  expect(copied.orphan.parentThreadId).toBeNull();
  expect(copied.orphan.sourceMessageId).toBeNull();
  return copied;
};

/**
 * One more thread than an insert batch holds, ordered so the earliest-created thread is the
 * child of the latest one: the child lands in batch 0, its parent in batch 1, and the copy has
 * to defer that link to an UPDATE after both batches are in.
 */
const seedCrossBatchThreads = async (
  topicId: string,
  owner: { agentId?: string; groupId?: string },
) => {
  const base = { ...owner, topicId, type: 'continuation' as const, userId };
  const start = Date.UTC(2026, 0, 1);
  await serverDB.insert(threads).values({
    ...base,
    createdAt: new Date(start + INSERT_BATCH_SIZE * 1000),
    id: `${topicId}-parent`,
    title: 'parent',
  });
  await serverDB.insert(threads).values([
    {
      ...base,
      createdAt: new Date(start),
      id: `${topicId}-child`,
      parentThreadId: `${topicId}-parent`,
      title: 'child',
    },
    ...Array.from({ length: INSERT_BATCH_SIZE - 1 }, (_, i) => ({
      ...base,
      createdAt: new Date(start + (i + 1) * 1000),
      id: `${topicId}-filler-${i}`,
    })),
  ]);
};

/** The copied child still points at the copied parent once the deferred fixup ran. */
const expectDeferredParentLink = async (newTopicId: string) => {
  const copied = await threadsOf(newTopicId);
  expect(copied).toHaveLength(INSERT_BATCH_SIZE + 1);
  const parent = copied.find((t) => t.title === 'parent')!;
  const child = copied.find((t) => t.title === 'child')!;
  expect(child.parentThreadId).toBe(parent.id);
  expect(parent.parentThreadId).toBeNull();
};

describe('AgentCopyJobModel coverage', () => {
  it('reports no pending group copy for an empty group list without querying', async () => {
    expect(await AgentCopyJobModel.hasPendingCopyJobForSourceGroups(serverDB, [])).toBe(false);
  });

  it('remaps thread parents and anchors that stay inside an agent topic, nulling the rest', async () => {
    const [source, target] = await serverDB
      .insert(agents)
      .values([
        { title: 'source', userId },
        { title: 'target', userId },
      ])
      .returning();
    await seedRemapEdges(
      'acj-cov-a',
      { agentId: source.id },
      { child: source.id, root: source.id },
    );
    await serverDB.insert(topics).values({ agentId: target.id, id: 'acj-cov-a-new', userId });
    const jobId = await AgentCopyJobModel.createJob(serverDB, {
      agents: [{ newAgentId: target.id, sourceAgentId: source.id }],
      source: scope,
      target: scope,
      topics: [
        {
          activityAt: new Date(),
          newAgentId: target.id,
          newTopicId: 'acj-cov-a-new',
          sourceAgentId: source.id,
          sourceTopicId: 'acj-cov-a-src',
        },
      ],
    });

    await AgentCopyJobModel.drain(serverDB, jobId);

    const copied = await expectRemappedThreads('acj-cov-a-new');
    expect(copied.child.agentId).toBe(target.id);
    expect(await jobOf(jobId)).toMatchObject({ completedTopics: 1, status: 'completed' });
  });

  it('copies a group topic for a job recorded without member agents', async () => {
    const [member] = await serverDB.insert(agents).values({ title: 'member', userId }).returning();
    await serverDB.insert(chatGroups).values([
      { id: 'acj-cov-g-src-group', userId },
      { id: 'acj-cov-g-new-group', userId },
    ]);
    await seedRemapEdges(
      'acj-cov-g',
      { groupId: 'acj-cov-g-src-group' },
      {
        child: member.id,
        root: null,
      },
    );
    await serverDB
      .insert(topics)
      .values({ groupId: 'acj-cov-g-new-group', id: 'acj-cov-g-new', userId });
    const group = { newGroupId: 'acj-cov-g-new-group', sourceGroupId: 'acj-cov-g-src-group' };
    const jobId = await AgentCopyJobModel.createJob(serverDB, {
      agents: [],
      group,
      source: scope,
      target: scope,
      topics: [
        { activityAt: new Date(), newTopicId: 'acj-cov-g-new', sourceTopicId: 'acj-cov-g-src' },
      ],
    });
    // The agent map is the job-level payload; a row that carries only the group still drains.
    await serverDB
      .update(agentHistoryJobs)
      .set({ payload: { group } })
      .where(eq(agentHistoryJobs.id, jobId));
    expect(
      await serverDB.query.agentHistoryJobAgents.findMany({
        where: (t, { eq: equals }) => equals(t.jobId, jobId),
      }),
    ).toEqual([]);

    await AgentCopyJobModel.drain(serverDB, jobId);

    const copied = await expectRemappedThreads('acj-cov-g-new');
    // Members outside the (empty) agent map, and agent-less threads, both land on no agent.
    expect(Object.values(copied).map((t) => [t.agentId, t.groupId])).toEqual(
      Array.from({ length: 3 }, () => [null, 'acj-cov-g-new-group']),
    );
    expect(await jobOf(jobId)).toMatchObject({ completedTopics: 1, status: 'completed' });
  });

  it('drops a queue row without a payload and still counts it', async () => {
    const [target] = await serverDB.insert(agents).values({ title: 'target', userId }).returning();
    await serverDB.insert(topics).values({ agentId: target.id, id: 'acj-cov-p-new', userId });
    const jobId = await AgentCopyJobModel.createJob(serverDB, {
      agents: [{ newAgentId: target.id, sourceAgentId: 'acj-cov-p-gone' }],
      source: scope,
      target: scope,
      topics: [{ activityAt: new Date(), newTopicId: 'acj-cov-p-new', sourceTopicId: 'unused' }],
    });
    await serverDB
      .update(agentHistoryJobTopics)
      .set({ payload: null })
      .where(eq(agentHistoryJobTopics.jobId, jobId));

    expect(await AgentCopyJobModel.processNextTopic(serverDB, jobId)).toEqual({
      done: false,
      topicId: 'acj-cov-p-new',
    });

    expect(await jobOf(jobId)).toMatchObject({ completedTopics: 1, status: 'pending' });
    // Without coordinates nothing is copied or cleaned up: the shell stays as it was.
    expect(
      await serverDB.query.topics.findFirst({ where: eq(topics.id, 'acj-cov-p-new') }),
    ).toBeDefined();
  });

  it('drops a personal target shell whose source topic was deleted', async () => {
    const [source, target] = await serverDB
      .insert(agents)
      .values([
        { title: 'source', userId },
        { title: 'target', userId },
      ])
      .returning();
    await serverDB.insert(topics).values({ agentId: target.id, id: 'acj-cov-d-new', userId });
    const jobId = await AgentCopyJobModel.createJob(serverDB, {
      agents: [{ newAgentId: target.id, sourceAgentId: source.id }],
      source: scope,
      target: scope,
      topics: [
        {
          activityAt: new Date(),
          newAgentId: target.id,
          newTopicId: 'acj-cov-d-new',
          sourceAgentId: source.id,
          sourceTopicId: 'acj-cov-d-deleted',
        },
      ],
    });

    await AgentCopyJobModel.drain(serverDB, jobId);

    expect(
      await serverDB.query.topics.findFirst({ where: eq(topics.id, 'acj-cov-d-new') }),
    ).toBeUndefined();
    expect(await jobOf(jobId)).toMatchObject({ completedTopics: 1, status: 'completed' });
  });

  it('defers an agent thread parent link that lands in a later insert batch', async () => {
    const [source, target] = await serverDB
      .insert(agents)
      .values([
        { title: 'source', userId },
        { title: 'target', userId },
      ])
      .returning();
    await serverDB.insert(topics).values([
      { agentId: source.id, id: 'acj-cov-wa-src', userId },
      { agentId: target.id, id: 'acj-cov-wa-new', userId },
    ]);
    await seedCrossBatchThreads('acj-cov-wa-src', { agentId: source.id });
    const jobId = await AgentCopyJobModel.createJob(serverDB, {
      agents: [{ newAgentId: target.id, sourceAgentId: source.id }],
      source: scope,
      target: scope,
      topics: [
        {
          activityAt: new Date(),
          newAgentId: target.id,
          newTopicId: 'acj-cov-wa-new',
          sourceAgentId: source.id,
          sourceTopicId: 'acj-cov-wa-src',
        },
      ],
    });

    await AgentCopyJobModel.drain(serverDB, jobId);

    await expectDeferredParentLink('acj-cov-wa-new');
  });

  it('defers a group thread parent link that lands in a later insert batch', async () => {
    await serverDB.insert(chatGroups).values([
      { id: 'acj-cov-wg-src-group', userId },
      { id: 'acj-cov-wg-new-group', userId },
    ]);
    await serverDB.insert(topics).values([
      { groupId: 'acj-cov-wg-src-group', id: 'acj-cov-wg-src', userId },
      { groupId: 'acj-cov-wg-new-group', id: 'acj-cov-wg-new', userId },
    ]);
    await seedCrossBatchThreads('acj-cov-wg-src', { groupId: 'acj-cov-wg-src-group' });
    const jobId = await AgentCopyJobModel.createJob(serverDB, {
      agents: [],
      group: { newGroupId: 'acj-cov-wg-new-group', sourceGroupId: 'acj-cov-wg-src-group' },
      source: scope,
      target: scope,
      topics: [
        { activityAt: new Date(), newTopicId: 'acj-cov-wg-new', sourceTopicId: 'acj-cov-wg-src' },
      ],
    });

    await AgentCopyJobModel.drain(serverDB, jobId);

    await expectDeferredParentLink('acj-cov-wg-new');
  });
});
