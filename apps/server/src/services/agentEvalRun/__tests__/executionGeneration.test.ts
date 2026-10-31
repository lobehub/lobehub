import type * as EvalRubric from '@lobechat/eval-rubric';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentEvalRunModel, AgentEvalRunTopicModel } from '@/database/models/agentEval';
import { ThreadModel } from '@/database/models/thread';
import { agentEvalDatasets, agentEvalTestCases, messages } from '@/database/schemas';
import { AgentEvalRunService } from '@/server/services/agentEvalRun';
import { EvalResumeConflictError } from '@/server/services/agentEvalRun/resumeTarget';
import { AgentEvalRunWorkflow } from '@/server/workflows/agentEvalRun';

import { cleanupDB, serverDB, setupEvalChain, userId } from './_setup';

const mocks = vi.hoisted(() => ({ evaluate: vi.fn(), exec: vi.fn(), interrupt: vi.fn() }));
vi.mock('@lobechat/eval-rubric', async (original) => ({
  ...(await original<typeof EvalRubric>()),
  evaluate: mocks.evaluate,
}));
vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn().mockImplementation(function () {
    return { execAgent: mocks.exec };
  }),
}));
vi.mock('@/server/services/agentRuntime/AgentRuntimeService', () => ({
  AgentRuntimeService: vi.fn().mockImplementation(function () {
    return { interruptOperation: mocks.interrupt };
  }),
}));
vi.mock('@/server/workflows/agentEvalRun', () => ({
  AgentEvalRunWorkflow: {
    triggerFinalizeRun: vi.fn(),
    triggerResumeAgentTrajectory: vi.fn(),
    triggerResumeThreadTrajectory: vi.fn(),
  },
}));
const passing = {
  passed: true,
  rubricResults: [{ passed: true, rubricId: 'eval-mode-contains', score: 1 }],
  score: 1,
};
const service = () => new AgentEvalRunService(serverDB, userId);
const rows = () => new AgentEvalRunTopicModel(serverDB, userId);
const runs = () => new AgentEvalRunModel(serverDB, userId);
const attempts = () => new ThreadModel(serverDB, userId);

beforeEach(async () => {
  await cleanupDB();
  vi.clearAllMocks();
  mocks.evaluate.mockReset().mockResolvedValue(passing);
  mocks.interrupt.mockReset().mockResolvedValue(true);
  mocks.exec.mockReset().mockImplementation(async (params) => {
    await params.onOperationCreated?.('new-operation');
    return { operationId: 'new-operation' };
  });
});

async function activeCase(threaded: boolean) {
  const chain = await setupEvalChain({
    assistantOutput: '42',
    datasetEvalMode: 'contains',
    totalCases: 1,
  });
  await runs().update(chain.run.id, {
    config: { k: threaded ? 2 : 1 },
    startedAt: new Date(0),
    status: 'running',
  });
  const thread = threaded
    ? await attempts().create({
        metadata: { executionId: 'old', operationId: 'old-operation', status: 'running' },
        topicId: chain.topic.id,
        type: 'eval',
      })
    : undefined;
  if (thread)
    await serverDB.insert(messages).values({
      content: '42',
      role: 'assistant',
      threadId: thread.id,
      topicId: chain.topic.id,
      userId,
    });
  await rows().updateByRunAndTopic(chain.run.id, chain.topic.id, {
    createdAt: new Date(0),
    evalResult: {
      executionId: 'old',
      operationId: 'old-operation',
      threads: thread
        ? [{ executionId: 'old', status: 'running', threadId: thread.id }]
        : undefined,
    },
    status: 'running',
  });
  const callback = (executionId?: string) => ({
    executionId,
    runId: chain.run.id,
    status: 'done',
    telemetry: { completionReason: 'done' },
    testCaseId: chain.testCase.id,
    topicId: chain.topic.id,
    ...(thread && { threadId: thread.id }),
  });
  const finish = (executionId?: string) =>
    thread
      ? service().recordThreadCompletion(callback(executionId) as any)
      : service().recordTrajectoryCompletion(callback(executionId));
  const resume = async (expectedExecutionId?: string) => {
    const params = {
      appContext: { topicId: chain.topic.id },
      expectedExecutionId,
      parentMessageId: 'resume-parent',
      runId: chain.run.id,
      testCaseId: chain.testCase.id,
      topicId: chain.topic.id,
      userId,
    };
    return thread
      ? service().executeResumedThreadTrajectory({
          ...params,
          appContext: { topicId: chain.topic.id, threadId: thread.id },
          threadId: thread.id,
        })
      : service().executeResumedTrajectory(params);
  };
  const current = () => rows().findByRunAndTestCase(chain.run.id, chain.testCase.id);
  return { ...chain, callback, current, finish, resume, thread };
}

describe.each([false, true])('execution generation isolation (threaded=%s)', (threaded) => {
  it.each(['Stop', 'timeout'] as const)(
    '%s then Resume ignores old and legacy callbacks, accepts current callback',
    async (stop) => {
      const c = await activeCase(threaded);
      if (stop === 'Stop') await service().abortRun(c.run.id);
      else await rows().batchMarkTimeout(c.run.id, 1);
      const stopped = await c.current();
      expect(stopped?.evalResult?.executionId).not.toBe('old');
      expect(await c.resume(stopped?.evalResult?.executionId)).toMatchObject({ status: 'started' });
      const resumed = await c.current();
      const resumedThread = c.thread ? await attempts().findById(c.thread.id) : undefined;
      await c.finish('old');
      await c.finish();
      expect(await c.current()).toEqual(resumed);
      if (c.thread) expect(await attempts().findById(c.thread.id)).toEqual(resumedThread);
      expect(mocks.evaluate).not.toHaveBeenCalled();
      const hook = mocks.exec.mock.calls[0][0].hooks[0];
      expect(hook.webhook.body.executionId).toBe(
        resumedThread?.metadata?.executionId ?? resumed?.evalResult?.executionId,
      );
      await hook.handler({ reason: 'done', status: 'done' });
      expect(mocks.evaluate).toHaveBeenCalledTimes(1);
      expect((await c.current())?.status).toBe('passed');
    },
  );

  it('dispatches the stopped generation through the Resume API before claiming it', async () => {
    const c = await activeCase(threaded);
    await service().abortRun(c.run.id);
    const stopped = await c.current();
    await service().resumeTrajectory({
      runId: c.run.id,
      testCaseId: c.testCase.id,
      threadId: c.thread?.id,
    });
    if (c.thread) {
      const payload = vi.mocked(AgentEvalRunWorkflow.triggerResumeThreadTrajectory).mock
        .calls[0][0];
      expect(payload.expectedExecutionId).toBe(stopped?.evalResult?.executionId);
      expect(await service().executeResumedThreadTrajectory(payload)).toMatchObject({
        status: 'started',
      });
    } else {
      const payload = vi.mocked(AgentEvalRunWorkflow.triggerResumeAgentTrajectory).mock.calls[0][0];
      expect(payload.expectedExecutionId).toBe(stopped?.evalResult?.executionId);
      expect(await service().executeResumedTrajectory(payload)).toMatchObject({
        status: 'started',
      });
    }
    const resumed = await c.current();
    await c.finish('old');
    expect(await c.current()).toEqual(resumed);
  });

  it('does not let a Judge already running before Stop overwrite the resumed generation', async () => {
    const c = await activeCase(threaded);
    let finishJudge!: (value: typeof passing) => void;
    let entered!: () => void;
    const judging = new Promise<void>((resolve) => {
      entered = resolve;
    });
    mocks.evaluate.mockImplementationOnce(() => {
      entered();
      return new Promise((resolve) => {
        finishJudge = resolve;
      });
    });
    const oldCompletion = c.finish('old');
    await judging;
    await service().abortRun(c.run.id);
    const stopped = await c.current();
    await c.resume(stopped?.evalResult?.executionId);
    const resumed = await c.current();
    const resumedThread = c.thread ? await attempts().findById(c.thread.id) : undefined;
    finishJudge(passing);
    await oldCompletion;
    expect(await c.current()).toEqual(resumed);
    if (c.thread) expect(await attempts().findById(c.thread.id)).toEqual(resumedThread);
    expect((await runs().findById(c.run.id))?.status).toBe('running');
  });

  it('claims only one operation for concurrent Resume requests with the same observed generation', async () => {
    const c = await activeCase(threaded);
    await rows().batchMarkTimeout(c.run.id, 1);
    const stopped = await c.current();
    const results = await Promise.all([
      c.resume(stopped?.evalResult?.executionId),
      c.resume(stopped?.evalResult?.executionId),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(['cancelled', 'started']);
    expect(mocks.exec).toHaveBeenCalledTimes(1);
  });
});

describe('case and run boundary guards', () => {
  it('seeds Rerun topics so a legacy callback cannot target the new pending case', async () => {
    const c = await activeCase(false);
    await service().abortRun(c.run.id);
    await service().retrySingleCase(c.run.id, c.testCase.id);
    const fresh = await c.current();
    expect(fresh?.topicId).not.toBe(c.topic.id);
    expect(fresh?.evalResult?.executionId).toEqual(expect.any(String));
    await c.finish('old');
    await c.finish();
    await service().recordTrajectoryCompletion({ ...c.callback(), topicId: undefined });
    expect(await c.current()).toEqual(fresh);
    expect(mocks.evaluate).not.toHaveBeenCalled();
  });

  it('rejects a stale finalizer both while resumed execution is active and after it finishes', async () => {
    const c = await activeCase(false);
    await rows().batchMarkTimeout(c.run.id, 1);
    const oldRun = await runs().findById(c.run.id);
    const stopped = await c.current();
    await c.resume(stopped?.evalResult?.executionId);
    const stale = () =>
      runs().finalize(
        c.run.id,
        {
          metrics: {
            averageScore: 0,
            failedCases: 0,
            passRate: 0,
            passedCases: 0,
            timeoutCases: 1,
            totalCases: 1,
          },
          status: 'failed',
        },
        { startedAt: oldRun?.startedAt },
      );
    expect(await stale()).toBeUndefined();
    await mocks.exec.mock.calls[0][0].hooks[0].handler({ reason: 'done', status: 'done' });
    expect(await stale()).toBeUndefined();
    expect(
      await runs().update(c.run.id, { metrics: oldRun?.metrics }, { startedAt: oldRun?.startedAt }),
    ).toBeUndefined();
    const currentRun = await runs().findById(c.run.id);
    expect(
      await runs().finalize(
        c.run.id,
        { status: 'completed' },
        { startedAt: currentRun?.startedAt },
      ),
    ).toMatchObject({ status: 'completed' });
  });

  it('cannot overwrite Resume with timeout telemetry delayed during operation interruption', async () => {
    const c = await activeCase(false);
    mocks.interrupt.mockImplementationOnce(async () => {
      const stopped = await c.current();
      await c.resume(stopped?.evalResult?.executionId);
      return true;
    });
    await service().checkAndHandleRunTimeout({
      config: { timeout: 1 },
      id: c.run.id,
      startedAt: new Date(0),
    });
    expect(await c.current()).toMatchObject({
      evalResult: { operationId: 'new-operation' },
      status: 'running',
    });
    expect((await c.current())?.evalResult).not.toHaveProperty('completionReason');
    expect((await runs().findById(c.run.id))?.status).toBe('running');
  });

  it('keeps a completion delivered before execAgent returns when binding the operation again', async () => {
    const c = await activeCase(false);
    await rows().batchMarkTimeout(c.run.id, 1);
    mocks.exec.mockImplementationOnce(async (params) => {
      await params.onOperationCreated('early-operation');
      await params.hooks[0].handler({ reason: 'done', status: 'done' });
      return { operationId: 'early-operation' };
    });
    await c.resume((await c.current())?.evalResult?.executionId);
    expect(await c.current()).toMatchObject({
      evalResult: { operationId: 'early-operation' },
      passed: true,
      status: 'passed',
    });
  });

  it.each(['changed', 'retired'] as const)(
    'rejects %s cases on the Resume API before changing evidence or dispatching',
    async (reason) => {
      const c = await activeCase(false);
      await service().abortRun(c.run.id);
      if (reason === 'changed')
        await serverDB
          .update(agentEvalDatasets)
          .set({ metadata: { release: 'new' } })
          .where(eq(agentEvalDatasets.id, c.dataset.id));
      else
        await serverDB
          .update(agentEvalTestCases)
          .set({ metadata: { retired: true } })
          .where(eq(agentEvalTestCases.id, c.testCase.id));
      const before = await c.current();
      await expect(
        service().resumeTrajectory({ runId: c.run.id, testCaseId: c.testCase.id }),
      ).rejects.toBeInstanceOf(EvalResumeConflictError);
      expect(await c.current()).toEqual(before);
      expect(AgentEvalRunWorkflow.triggerResumeAgentTrajectory).not.toHaveBeenCalled();
      expect(mocks.exec).not.toHaveBeenCalled();
    },
  );
});
