import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentEvalRunModel, AgentEvalRunTopicModel } from '@/database/models/agentEval';
import { AgentEvalExecutionRepo } from '@/database/repositories/agentEvalExecution';
import { agentEvalRuns, agentEvalRunTopics } from '@/database/schemas';
import { AgentEvalRunService } from '@/server/services/agentEvalRun';
import { AgentEvalRunWorkflow } from '@/server/workflows/agentEvalRun';

import { cleanupDB, serverDB, setupMultiCaseRun, userId } from './_setup';

vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: vi.fn(),
}));

vi.mock('@/server/services/agentRuntime/AgentRuntimeService', () => ({
  AgentRuntimeService: vi.fn().mockImplementation(function () {
    return { interruptOperation: vi.fn().mockResolvedValue(true) };
  }),
}));

const triggerSpy = vi.spyOn(AgentEvalRunWorkflow, 'triggerExecuteTestCase');

beforeEach(async () => {
  await cleanupDB();
  triggerSpy.mockReset();
  triggerSpy.mockResolvedValue({ workflowRunId: 'wf' } as never);
});

const startedCases = () => triggerSpy.mock.calls.map(([payload]) => payload.testCaseId);

/** A run of `count` cases, started (running) with the given config. */
const setupQueuedRun = async (count: number, config: Record<string, unknown>) => {
  const setup = await setupMultiCaseRun(Array.from({ length: count }, () => ({})));
  await new AgentEvalRunModel(serverDB, userId).update(setup.run.id, {
    config,
    status: 'running',
  });
  // As createRun leaves them: every case waits as 'pending'.
  await serverDB
    .update(agentEvalRunTopics)
    .set({ status: 'pending' })
    .where(eq(agentEvalRunTopics.runId, setup.run.id));
  return setup;
};

const topicOf = async (runId: string, testCaseId: string) =>
  new AgentEvalRunTopicModel(serverDB, userId).findByRunAndTestCase(runId, testCaseId);

describe('runs with a concurrency limit (maxConcurrency)', () => {
  it('starts only as many cases as the limit allows', async () => {
    const { run, cases } = await setupQueuedRun(5, { maxConcurrency: 2 });
    const service = new AgentEvalRunService(serverDB, userId);

    const started = await service.dispatchQueuedCases(run.id);

    expect(started).toEqual([cases[0].testCase.id, cases[1].testCase.id]);
    expect(startedCases()).toEqual(started);
    // The two started cases hold their slots until they run: a second call starts none.
    expect(await service.dispatchQueuedCases(run.id)).toEqual([]);
    expect(triggerSpy).toHaveBeenCalledTimes(2);
  });

  it('leaves a run without a limit to the paginated fan-out', async () => {
    const { run } = await setupQueuedRun(3, {});

    expect(await new AgentEvalRunService(serverDB, userId).dispatchQueuedCases(run.id)).toBe(
      undefined,
    );
    expect(triggerSpy).not.toHaveBeenCalled();
  });

  it('starts the next waiting case when a case finishes', async () => {
    const { run, cases } = await setupQueuedRun(3, { maxConcurrency: 1 });
    const service = new AgentEvalRunService(serverDB, userId);
    await serverDB
      .update(agentEvalRunTopics)
      .set({ status: 'running' })
      .where(eq(agentEvalRunTopics.testCaseId, cases[0].testCase.id));

    const { allDone } = await service.recordTrajectoryCompletion({
      runId: run.id,
      status: 'error',
      telemetry: { completionReason: 'error', errorMessage: 'boom' },
      testCaseId: cases[0].testCase.id,
    });

    expect(allDone).toBe(false);
    expect(startedCases()).toEqual([cases[1].testCase.id]);
  });

  it('frees the slots of timed-out cases', async () => {
    const { run, cases } = await setupQueuedRun(2, { maxConcurrency: 1, timeout: 1_200_000 });
    await serverDB
      .update(agentEvalRuns)
      .set({ startedAt: sql`NOW() - interval '30 minutes'` })
      .where(eq(agentEvalRuns.id, run.id));
    await serverDB
      .update(agentEvalRunTopics)
      .set({ createdAt: sql`NOW() - interval '25 minutes'`, status: 'running' })
      .where(eq(agentEvalRunTopics.testCaseId, cases[0].testCase.id));
    const current = await new AgentEvalRunModel(serverDB, userId).findById(run.id);

    const changed = await new AgentEvalRunService(serverDB, userId).checkAndHandleRunTimeout(
      current!,
    );

    expect(changed).toBe(true);
    expect((await topicOf(run.id, cases[0].testCase.id))?.status).toBe('timeout');
    expect(startedCases()).toEqual([cases[1].testCase.id]);
  });

  it('hands out a slot again when its start never reached the case', async () => {
    const { run, cases } = await setupQueuedRun(2, { maxConcurrency: 1 });
    const stale = new Date(Date.now() - 10 * 60_000).toISOString();
    await serverDB
      .update(agentEvalRunTopics)
      .set({ evalResult: { dispatchedAt: stale } })
      .where(eq(agentEvalRunTopics.testCaseId, cases[0].testCase.id));

    const started = await new AgentEvalRunService(serverDB, userId).dispatchQueuedCases(run.id);

    expect(started).toEqual([cases[0].testCase.id]);
  });

  it('gives back the slot of a case whose start could not be triggered', async () => {
    const { run, cases } = await setupQueuedRun(3, { maxConcurrency: 2 });
    triggerSpy.mockRejectedValueOnce(new Error('qstash down'));
    const service = new AgentEvalRunService(serverDB, userId);

    expect(await service.dispatchQueuedCases(run.id)).toEqual([cases[1].testCase.id]);
    expect((await topicOf(run.id, cases[0].testCase.id))?.evalResult?.dispatchedAt).toBe(undefined);
    expect(await service.dispatchQueuedCases(run.id)).toEqual([cases[0].testCase.id]);
  });

  it('fails the dispatch when no queued case could be started, so the step is retried', async () => {
    const { run, cases } = await setupQueuedRun(2, { maxConcurrency: 1 });
    triggerSpy.mockRejectedValueOnce(new Error('qstash down'));
    const service = new AgentEvalRunService(serverDB, userId);

    await expect(service.dispatchQueuedCases(run.id)).rejects.toThrow(
      /Could not start any queued case/,
    );
    // The released slot is handed out again on the retry.
    expect(await service.dispatchQueuedCases(run.id)).toEqual([cases[0].testCase.id]);
  });

  it('times a pass@k case from when it starts, not from when the run was created', async () => {
    const { run, cases } = await setupQueuedRun(1, { k: 2, timeout: 1_200_000 });
    const [{ testCase, topic }] = cases;
    await serverDB
      .update(agentEvalRuns)
      .set({ startedAt: sql`NOW() - interval '30 minutes'` })
      .where(eq(agentEvalRuns.id, run.id));
    // The case waited 25 minutes for a slot before it started.
    await serverDB
      .update(agentEvalRunTopics)
      .set({ createdAt: sql`NOW() - interval '25 minutes'` })
      .where(eq(agentEvalRunTopics.testCaseId, testCase.id));

    await new AgentEvalExecutionRepo(serverDB, userId).prepareThreadExecutions({
      k: 2,
      runId: run.id,
      testCaseId: testCase.id,
      topicId: topic.id,
    });
    const current = await new AgentEvalRunModel(serverDB, userId).findById(run.id);
    const changed = await new AgentEvalRunService(serverDB, userId).checkAndHandleRunTimeout(
      current!,
    );

    expect(changed).toBe(false);
    expect((await topicOf(run.id, testCase.id))?.status).toBe('running');
  });
});
