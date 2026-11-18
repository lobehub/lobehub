import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import {
  agentEvalDatasets,
  agentEvalRuns,
  agentEvalRunTopics,
  agentEvalTestCases,
  threads,
  topics,
  users,
  workspaces,
} from '../../../schemas';
import { AgentEvalExecutionRepo } from '../index';

const db = await getTestDB();
const owner = 'eval-execution-owner';
const other = 'eval-execution-other';
const workspace = 'eval-execution-workspace';
const foreignWorkspace = 'eval-execution-foreign-workspace';

beforeEach(async () => {
  await db.insert(users).values([{ id: owner }, { id: other }]);
  await db.insert(workspaces).values([
    { id: workspace, name: 'Execution', primaryOwnerId: owner, slug: workspace },
    {
      id: foreignWorkspace,
      name: 'Foreign execution',
      primaryOwnerId: other,
      slug: foreignWorkspace,
    },
  ]);
});

afterEach(async () => {
  await db.delete(workspaces).where(eq(workspaces.id, workspace));
  await db.delete(workspaces).where(eq(workspaces.id, foreignWorkspace));
  await db.delete(users).where(eq(users.id, owner));
  await db.delete(users).where(eq(users.id, other));
});

const setup = async (
  options: {
    parentWorkspace?: string;
    runOwner?: string;
    runWorkspace?: string;
    threadOwner?: string;
    threadWorkspace?: string;
  } = {},
) => {
  const [dataset] = await db
    .insert(agentEvalDatasets)
    .values({
      identifier: 'execution',
      name: 'Execution',
      userId: owner,
    })
    .returning();
  const [testCase] = await db
    .insert(agentEvalTestCases)
    .values({
      content: { input: 'Question' },
      datasetId: dataset.id,
      userId: owner,
    })
    .returning();
  const [run] = await db
    .insert(agentEvalRuns)
    .values({
      datasetId: dataset.id,
      status: 'aborted',
      userId: options.runOwner ?? owner,
      workspaceId: options.runWorkspace ?? null,
    })
    .returning();
  const [topic] = await db
    .insert(topics)
    .values({ userId: owner, workspaceId: options.parentWorkspace ?? null })
    .returning();
  await db.insert(agentEvalRunTopics).values({
    evalResult: { executionId: 'old' },
    runId: run.id,
    status: 'error',
    testCaseId: testCase.id,
    topicId: topic.id,
    userId: owner,
    workspaceId: options.parentWorkspace ?? null,
  });
  const [thread] = await db
    .insert(threads)
    .values({
      metadata: { executionId: 'old', status: 'error' },
      topicId: topic.id,
      type: 'eval',
      userId: options.threadOwner ?? owner,
      workspaceId: options.threadWorkspace ?? null,
    })
    .returning();
  return { run, testCase, thread, topic };
};

const claim = (chain: Awaited<ReturnType<typeof setup>>, workspaceId?: string, threaded = false) =>
  new AgentEvalExecutionRepo(db, owner, workspaceId).claimExecution({
    executionId: 'new',
    expectedExecutionId: 'old',
    resume: true,
    runId: chain.run.id,
    testCaseId: chain.testCase.id,
    topicId: chain.topic.id,
    ...(threaded && { threadId: chain.thread.id }),
  });

const expectUnchanged = async (chain: Awaited<ReturnType<typeof setup>>) => {
  const [run] = await db.select().from(agentEvalRuns).where(eq(agentEvalRuns.id, chain.run.id));
  const [parent] = await db
    .select()
    .from(agentEvalRunTopics)
    .where(eq(agentEvalRunTopics.runId, chain.run.id));
  const [thread] = await db.select().from(threads).where(eq(threads.id, chain.thread.id));
  expect(run.status).toBe('aborted');
  expect(parent).toMatchObject({ status: 'error', evalResult: { executionId: 'old' } });
  expect(thread.metadata).toEqual({ executionId: 'old', status: 'error' });
};

describe('AgentEvalExecutionRepo ownership', () => {
  it('rejects an owned association whose run belongs to another user', async () => {
    const chain = await setup({ runOwner: other });
    expect(await claim(chain)).toBeUndefined();
    await expectUnchanged(chain);
  });

  it('rejects a run in another workspace even when its association matches', async () => {
    const chain = await setup({ parentWorkspace: workspace, runWorkspace: foreignWorkspace });
    expect(await claim(chain, workspace)).toBeUndefined();
    await expectUnchanged(chain);
  });

  it('rejects a foreign thread under an otherwise owned run and topic', async () => {
    const chain = await setup({ threadOwner: other });
    expect(await claim(chain, undefined, true)).toBeUndefined();
    await expectUnchanged(chain);
  });

  it('allows a workspace member to resume a run and thread created by a different member', async () => {
    const chain = await setup({
      parentWorkspace: workspace,
      runOwner: other,
      runWorkspace: workspace,
      threadOwner: other,
      threadWorkspace: workspace,
    });
    expect(await claim(chain, workspace, true)).toBeDefined();
    const [run] = await db.select().from(agentEvalRuns).where(eq(agentEvalRuns.id, chain.run.id));
    const [thread] = await db.select().from(threads).where(eq(threads.id, chain.thread.id));
    expect(run.status).toBe('running');
    expect(thread.metadata).toMatchObject({ executionId: 'new', status: 'running' });
  });

  it('does not accept another generation after the first resume has claimed it', async () => {
    const chain = await setup();
    expect(await claim(chain)).toBeDefined();
    expect(await claim(chain)).toBeUndefined();
  });
});

describe('AgentEvalExecutionRepo pass@k allocation', () => {
  const pendingChain = async (options: Parameters<typeof setup>[0] = {}) => {
    const chain = await setup(options);
    await db.delete(threads).where(eq(threads.id, chain.thread.id));
    await db
      .update(agentEvalRuns)
      .set({ status: 'running' })
      .where(eq(agentEvalRuns.id, chain.run.id));
    await db
      .update(agentEvalRunTopics)
      .set({ status: 'pending' })
      .where(eq(agentEvalRunTopics.runId, chain.run.id));
    return chain;
  };
  const prepare = (
    chain: Awaited<ReturnType<typeof setup>>,
    workspaceId?: string,
    expectedExecutionId = 'old',
  ) =>
    new AgentEvalExecutionRepo(db, owner, workspaceId).prepareThreadExecutions({
      expectedExecutionId,
      k: 2,
      runId: chain.run.id,
      testCaseId: chain.testCase.id,
      topicId: chain.topic.id,
    });

  it('rejects a parent association whose run is outside the workspace', async () => {
    const chain = await pendingChain({
      parentWorkspace: workspace,
      runWorkspace: foreignWorkspace,
    });
    expect(await prepare(chain, workspace)).toBeUndefined();
    expect(await db.select().from(threads).where(eq(threads.topicId, chain.topic.id))).toEqual([]);
  });

  it('rejects a stale parent generation without allocating threads', async () => {
    const chain = await pendingChain();
    expect(await prepare(chain, undefined, 'stale')).toBeUndefined();
    expect(await db.select().from(threads).where(eq(threads.topicId, chain.topic.id))).toEqual([]);
  });

  it('reuses a single attempt set in an authorized workspace with the stable parent owner', async () => {
    const chain = await pendingChain({ parentWorkspace: workspace, runWorkspace: workspace });
    const repo = new AgentEvalExecutionRepo(db, other, workspace);
    const input = {
      expectedExecutionId: 'old',
      k: 2,
      runId: chain.run.id,
      testCaseId: chain.testCase.id,
      topicId: chain.topic.id,
    };
    const first = await repo.prepareThreadExecutions(input);
    const retried = await repo.prepareThreadExecutions(input);
    expect(first?.threadIds).toHaveLength(2);
    expect(retried?.threadIds).toEqual(first?.threadIds);
    const saved = await db.select().from(threads).where(eq(threads.topicId, chain.topic.id));
    expect(saved).toHaveLength(2);
    expect(saved.every((row) => row.userId === owner && row.workspaceId === workspace)).toBe(true);
  });
});
