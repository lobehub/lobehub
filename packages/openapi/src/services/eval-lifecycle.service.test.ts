import { beforeAll, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import {
  agentEvalBenchmarks,
  agentEvalDatasets,
  agentEvalRuns,
  agentEvalRunTopics,
  agentEvalTestCases,
  topics,
  users,
} from '@/database/schemas';

import { EvalLifecycleService } from './eval-lifecycle.service';

vi.mock('@/server/workflows/agentEvalRun', () => ({
  AgentEvalRunWorkflow: { triggerRunBenchmark: vi.fn() },
}));
const db = await getTestDB();
const owner = new EvalLifecycleService(db, 'lifecycle-owner');
const foreign = new EvalLifecycleService(db, 'lifecycle-foreign');
beforeAll(async () => {
  await db.insert(users).values([{ id: 'lifecycle-owner' }, { id: 'lifecycle-foreign' }]);
  await db.insert(agentEvalBenchmarks).values({
    id: 'lifecycle-benchmark',
    identifier: 'lifecycle-benchmark',
    name: 'Lifecycle',
    rubrics: [],
    isSystem: false,
    userId: 'lifecycle-owner',
  });
  await db.insert(agentEvalDatasets).values({
    id: 'lifecycle-dataset',
    benchmarkId: 'lifecycle-benchmark',
    identifier: 'lifecycle-dataset',
    name: 'Lifecycle',
    userId: 'lifecycle-owner',
  });
  await db.insert(agentEvalTestCases).values({
    id: 'lifecycle-case',
    datasetId: 'lifecycle-dataset',
    content: { input: 'x' },
    userId: 'lifecycle-owner',
  });
});
const seedRun = async (id: string, status: 'pending' | 'running' = 'pending') => {
  await db.insert(agentEvalRuns).values({
    id,
    datasetId: 'lifecycle-dataset',
    userId: 'lifecycle-owner',
    config: { executionMode: 'external', k: 1 },
    status,
  });
};
describe('external run lifecycle', () => {
  it('reports shared dataset cases and counts the whole readable dataset', async () => {
    await db.insert(agentEvalDatasets).values({
      id: 'shared-lifecycle-dataset',
      identifier: 'shared-lifecycle-dataset',
      name: 'Shared cases',
    });
    await db.insert(agentEvalTestCases).values(
      ['shared-case-1', 'shared-case-2'].map((id) => ({
        id,
        datasetId: 'shared-lifecycle-dataset',
        content: { input: id },
        userId: 'lifecycle-foreign',
      })),
    );
    await db.insert(agentEvalRuns).values({
      id: 'shared-case-run',
      datasetId: 'shared-lifecycle-dataset',
      userId: 'lifecycle-owner',
      config: { executionMode: 'external', k: 1 },
      status: 'pending',
    });
    await db
      .insert(topics)
      .values(
        ['shared-topic-1', 'shared-topic-2'].map((id) => ({ id, userId: 'lifecycle-owner' })),
      );
    await owner.claim('shared-case-run');
    await expect(
      owner.report('shared-case-run', 'shared-topic-1', {
        testCaseId: 'lifecycle-case',
        score: 1,
        correct: true,
      }),
    ).rejects.toMatchObject({ name: 'NotFoundError' });
    expect(
      await owner.report('shared-case-run', 'shared-topic-1', {
        testCaseId: 'shared-case-1',
        score: 1,
        correct: true,
      }),
    ).toMatchObject({ runStatus: 'running' });
    const first = (await db.select().from(agentEvalRuns)).find(
      (run) => run.id === 'shared-case-run',
    );
    expect(first?.metrics).toMatchObject({ totalCases: 2, completedCases: 1, passRate: 0.5 });
    await expect(owner.setStatus('shared-case-run', { status: 'completed' })).rejects.toMatchObject(
      {
        name: 'ConflictError',
      },
    );
    expect(
      await owner.report('shared-case-run', 'shared-topic-2', {
        testCaseId: 'shared-case-2',
        score: 1,
        correct: true,
      }),
    ).toMatchObject({ runStatus: 'completed' });
  });
  it('allows exactly one worker to claim, isolates ownership and rejects internal claims', async () => {
    await seedRun('claim-run');
    await expect(foreign.claim('claim-run')).rejects.toMatchObject({ name: 'NotFoundError' });
    const outcomes = await Promise.allSettled(
      Array.from({ length: 8 }, () => owner.claim('claim-run')),
    );
    expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const r of outcomes)
      if (r.status === 'rejected') expect(r.reason.name).toBe('ConflictError');
    await db.insert(agentEvalRuns).values({
      id: 'internal-run',
      datasetId: 'lifecycle-dataset',
      userId: 'lifecycle-owner',
      config: { executionMode: 'internal' },
      status: 'pending',
    });
    await expect(owner.claim('internal-run')).rejects.toMatchObject({ name: 'ConflictError' });
  });
  it('rejects unclaimed completion and preserves terminal state on repeated status updates', async () => {
    await seedRun('status-run');
    await expect(owner.setStatus('status-run', { status: 'completed' })).rejects.toMatchObject({
      name: 'ConflictError',
    });
    await owner.claim('status-run');
    await expect(owner.setStatus('status-run', { status: 'completed' })).rejects.toMatchObject({
      name: 'ConflictError',
    });
    expect(await owner.setStatus('status-run', { status: 'aborted' })).toMatchObject({
      status: 'aborted',
    });
    expect(await owner.setStatus('status-run', { status: 'aborted' })).toMatchObject({
      status: 'aborted',
    });
    await expect(owner.setStatus('status-run', { status: 'running' })).rejects.toMatchObject({
      name: 'ConflictError',
    });
  });
  it('rolls back failed batches and enforces idempotent result identity', async () => {
    await seedRun('report-run', 'running');
    await db.insert(topics).values({ id: 'report-topic', userId: 'lifecycle-owner' });
    await db.insert(agentEvalRunTopics).values({
      runId: 'report-run',
      topicId: 'report-topic',
      testCaseId: 'lifecycle-case',
      userId: 'lifecycle-owner',
      status: 'external',
    });
    const result = { topicId: 'report-topic', score: 1, correct: true, result: { answer: 'ok' } };
    await expect(
      owner.reportBatch('report-run', { items: [result, { ...result, topicId: 'foreign-topic' }] }),
    ).rejects.toMatchObject({ name: 'NotFoundError' });
    const row = await db.select().from(agentEvalRunTopics);
    expect(row.find((r) => r.runId === 'report-run')?.score).toBeNull();
    expect(await owner.reportBatch('report-run', { items: [result] })).toMatchObject({
      items: [{ idempotent: false }],
      runStatus: 'completed',
    });
    expect(await owner.reportBatch('report-run', { items: [result] })).toMatchObject({
      items: [{ idempotent: true }],
    });
    await expect(
      owner.reportBatch('report-run', { items: [{ ...result, score: 0 }] }),
    ).rejects.toMatchObject({ name: 'ConflictError' });
    await expect(foreign.reportBatch('report-run', { items: [result] })).rejects.toMatchObject({
      name: 'NotFoundError',
    });
  });
  it('lets an external worker attach its own public topic to a dataset case when reporting', async () => {
    await seedRun('worker-run', 'running');
    await db.insert(topics).values({ id: 'worker-topic', userId: 'lifecycle-owner' });
    const report = {
      topicId: 'worker-topic',
      testCaseId: 'lifecycle-case',
      score: 1,
      correct: true,
    };
    expect(await owner.reportBatch('worker-run', { items: [report] })).toMatchObject({
      runStatus: 'completed',
    });
    expect(await owner.reportBatch('worker-run', { items: [report] })).toMatchObject({
      items: [{ idempotent: true }],
    });
  });
  it('replays failed results without changing aggregates or reopening the run', async () => {
    await seedRun('error-run', 'running');
    await db.insert(topics).values({ id: 'error-topic', userId: 'lifecycle-owner' });
    const report = {
      topicId: 'error-topic',
      testCaseId: 'lifecycle-case',
      score: 0,
      correct: false,
      result: { error: 'Worker failed' },
    };
    expect(await owner.reportBatch('error-run', { items: [report] })).toMatchObject({
      runStatus: 'failed',
    });
    const before = (await db.select().from(agentEvalRuns)).find((run) => run.id === 'error-run');
    expect(await owner.reportBatch('error-run', { items: [report] })).toMatchObject({
      runStatus: 'failed',
      items: [{ idempotent: true }],
    });
    const after = (await db.select().from(agentEvalRuns)).find((run) => run.id === 'error-run');
    expect(after).toEqual(before);
    await expect(
      owner.reportBatch('error-run', { items: [{ ...report, score: 1 }] }),
    ).rejects.toMatchObject({ name: 'ConflictError' });
  });
});
