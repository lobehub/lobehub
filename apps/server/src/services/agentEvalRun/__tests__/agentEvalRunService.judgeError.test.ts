import type * as EvalRubric from '@lobechat/eval-rubric';
import type { EvaluateResult } from '@lobechat/eval-rubric';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AgentEvalBenchmarkModel,
  AgentEvalRunModel,
  AgentEvalRunTopicModel,
} from '@/database/models/agentEval';
import { ThreadModel } from '@/database/models/thread';
import {
  agentEvalDatasets,
  agentEvalRunTopics,
  agentEvalTestCases,
  messages,
  topics,
} from '@/database/schemas';
import { AgentEvalRunService } from '@/server/services/agentEvalRun';

import { cleanupDB, serverDB, setupEvalChain, setupMultiCaseRun, userId } from './_setup';

/**
 * The judge is the only thing faked here: every test drives the real
 * completion, aggregation, re-judge and retry paths against the test DB and
 * asserts that a judge failure never becomes a verdict and never costs a
 * candidate run.
 */
const evaluate = vi.fn<(...args: unknown[]) => Promise<EvaluateResult>>();
vi.mock('@lobechat/eval-rubric', async (importOriginal) => ({
  ...(await importOriginal<typeof EvalRubric>()),
  evaluate: (...args: unknown[]) => evaluate(...args),
}));

const execAgent = vi.fn();
vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn().mockImplementation(function () {
    return { execAgent };
  }),
}));

vi.mock('@/server/services/agentRuntime/AgentRuntimeService', () => ({
  AgentRuntimeService: vi.fn().mockImplementation(function () {
    return { interruptOperation: vi.fn().mockResolvedValue(true) };
  }),
}));

const RUBRIC_ID = 'eval-mode-contains';
const verdict = (passed: boolean, score: number): EvaluateResult => ({
  passed,
  rubricResults: [
    { passed, reason: passed ? 'matches' : 'does not match', rubricId: RUBRIC_ID, score },
  ],
  score,
});
const judgeFailure = (judgeError: string): EvaluateResult => ({
  judgeError,
  passed: false,
  rubricResults: [{ judgeError, passed: false, rubricId: RUBRIC_ID, score: 0 }],
  score: 0,
});

const runTopicModel = () => new AgentEvalRunTopicModel(serverDB, userId);
const runModel = () => new AgentEvalRunModel(serverDB, userId);
const service = () => new AgentEvalRunService(serverDB, userId);
/** The model instances a service instance reads through; model methods are instance fields. */
const depsOf = (svc: AgentEvalRunService) => svc['deps'];

/** One k=1 case whose candidate answered and whose attempt cost 0.02. */
const completeSingleCase = async (svc = service()) => {
  const chain = await setupEvalChain({
    assistantOutput: 'The answer is 42.',
    datasetEvalMode: 'contains',
    totalCases: 1,
  });
  const done = await svc.recordTrajectoryCompletion({
    runId: chain.run.id,
    status: 'completed',
    telemetry: { completionReason: 'stop', cost: 0.02, duration: 1500, steps: 3, totalTokens: 120 },
    testCaseId: chain.testCase.id,
  });
  const runTopic = await runTopicModel().findByRunAndTestCase(chain.run.id, chain.testCase.id);
  return { ...chain, done, runTopic: runTopic! };
};

/** A k=2 case with two eval threads that both answered. */
const setupTwoThreadCase = async (svc = service()) => {
  const benchmark = await new AgentEvalBenchmarkModel(serverDB, userId).create({
    identifier: 'k2-benchmark',
    isSystem: false,
    name: 'k2 Benchmark',
    rubrics: [],
  });
  const [dataset] = await serverDB
    .insert(agentEvalDatasets)
    .values({
      benchmarkId: benchmark.id,
      evalMode: 'contains',
      identifier: 'k2-dataset',
      name: 'k2 Dataset',
      userId,
    })
    .returning();
  const [testCase] = await serverDB
    .insert(agentEvalTestCases)
    .values({
      content: { expected: '42', input: 'What is 6*7?' },
      datasetId: dataset.id,
      sortOrder: 1,
      userId,
    })
    .returning();
  const run = await runModel().create({ config: { k: 2 }, datasetId: dataset.id, name: 'k2 Run' });
  await runModel().update(run.id, {
    metrics: { averageScore: 0, failedCases: 0, passRate: 0, passedCases: 0, totalCases: 1 },
  });
  const [topic] = await serverDB
    .insert(topics)
    .values({ mode: 'test', title: 'k2 Topic', trigger: 'eval', userId })
    .returning();
  await runTopicModel().batchCreate([
    { runId: run.id, status: 'running', testCaseId: testCase.id, topicId: topic.id },
  ]);
  const threadModel = new ThreadModel(serverDB, userId);
  const threadIds: string[] = [];
  for (let i = 0; i < 2; i++) {
    const thread = await threadModel.create({ topicId: topic.id, type: 'eval' });
    threadIds.push(thread!.id);
    await serverDB.insert(messages).values({
      content: `attempt ${i}: 42`,
      role: 'assistant',
      threadId: thread!.id,
      topicId: topic.id,
      userId,
    });
  }
  const completeThread = (index: number) =>
    svc.recordThreadCompletion({
      runId: run.id,
      status: 'completed',
      telemetry: {
        completionReason: 'stop',
        cost: 0.01 * (index + 1),
        duration: 1000,
        totalTokens: 50,
      },
      testCaseId: testCase.id,
      threadId: threadIds[index],
      topicId: topic.id,
    });
  return { completeThread, run, testCase, threadIds, topic };
};

beforeEach(async () => {
  await cleanupDB();
  vi.restoreAllMocks();
  evaluate.mockReset();
  execAgent.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('judge failures on a single-attempt case', () => {
  it('records a judge that reports judgeError as judge_error with no verdict, keeping the attempt', async () => {
    evaluate.mockResolvedValueOnce(judgeFailure('Judge model returned no parseable verdict'));

    const { done, run, runTopic, topic } = await completeSingleCase();

    expect(done.allDone).toBe(true);
    expect(runTopic.status).toBe('judge_error');
    expect(runTopic.passed).toBeNull();
    expect(runTopic.score).toBeNull();
    expect(runTopic.topicId).toBe(topic.id);
    expect(runTopic.evalResult).toMatchObject({
      completionReason: 'stop',
      cost: 0.02,
      errorPhase: 'judge',
      judgeError: 'Judge model returned no parseable verdict',
      rubricScores: [],
      steps: 3,
      tokens: 120,
    });

    const metrics = (await runModel().findById(run.id))!.metrics!;
    expect(metrics).toMatchObject({ failedCases: 0, judgeErrorCases: 1, passedCases: 0 });
  });

  it('records a judge that throws the same way', async () => {
    evaluate.mockRejectedValueOnce(new Error('provider 502'));

    const { runTopic } = await completeSingleCase();

    expect(runTopic.status).toBe('judge_error');
    expect(runTopic.passed).toBeNull();
    expect(runTopic.score).toBeNull();
    expect(runTopic.evalResult).toMatchObject({
      cost: 0.02,
      errorPhase: 'judge',
      judgeError: 'Judge failed: provider 502',
    });
  });

  it('keeps a real zero score as a failed verdict', async () => {
    evaluate.mockResolvedValueOnce(verdict(false, 0));

    const { run, runTopic } = await completeSingleCase();

    expect(runTopic.status).toBe('failed');
    expect(runTopic.passed).toBe(false);
    expect(runTopic.score).toBe(0);
    expect(runTopic.evalResult?.judgeError).toBeUndefined();
    expect(runTopic.evalResult?.rubricScores).toEqual([
      { reason: 'does not match', rubricId: RUBRIC_ID, score: 0 },
    ]);
    const metrics = (await runModel().findById(run.id))!.metrics!;
    expect(metrics.failedCases).toBe(1);
    expect(metrics.judgeErrorCases).toBeUndefined();
  });

  it('ignores a late completion webhook for a case already marked judge_error', async () => {
    evaluate.mockResolvedValueOnce(judgeFailure('first'));
    const { run, testCase } = await completeSingleCase();
    evaluate.mockResolvedValueOnce(verdict(true, 1));

    await service().recordTrajectoryCompletion({
      runId: run.id,
      status: 'completed',
      telemetry: { completionReason: 'stop', cost: 0.5 },
      testCaseId: testCase.id,
    });

    const runTopic = await runTopicModel().findByRunAndTestCase(run.id, testCase.id);
    expect(runTopic?.status).toBe('judge_error');
    expect(runTopic?.evalResult?.cost).toBe(0.02);
    expect(evaluate).toHaveBeenCalledTimes(1);
  });
});

describe('judge failures on a pass@k case', () => {
  it('leaves the case unjudged when one of two attempts cannot be graded', async () => {
    const { completeThread, run, testCase, threadIds } = await setupTwoThreadCase();
    evaluate.mockResolvedValueOnce(verdict(true, 1));
    await completeThread(0);
    evaluate.mockResolvedValueOnce(judgeFailure('rate limited'));
    const second = await completeThread(1);

    expect(second.allThreadsDone).toBe(true);
    const runTopic = (await runTopicModel().findByRunAndTestCase(run.id, testCase.id))!;
    expect(runTopic.status).toBe('judge_error');
    expect(runTopic.passed).toBeNull();
    expect(runTopic.score).toBeNull();
    expect(runTopic.evalResult?.passAtK).toBeUndefined();
    expect(runTopic.evalResult?.passAllK).toBeUndefined();
    expect(runTopic.evalResult?.judgeError).toBe(
      '1 of 2 attempts could not be judged: rate limited',
    );
    expect(runTopic.evalResult?.totalCost).toBeCloseTo(0.03);
    // Threads are listed in storage order, not completion order.
    const byId = new Map(runTopic.evalResult!.threads!.map((t) => [t.threadId, t]));
    expect(byId.get(threadIds[0])).toMatchObject({ passed: true, status: 'passed' });
    const failed = byId.get(threadIds[1])!;
    expect(failed).toMatchObject({ cost: 0.02, judgeError: 'rate limited', status: 'judge_error' });
    expect(failed.passed).toBeUndefined();
    expect(failed.score).toBeUndefined();

    const metrics = (await runModel().findById(run.id))!.metrics!;
    expect(metrics).toMatchObject({ failedCases: 0, judgeErrorCases: 1, passedCases: 0 });
  });

  it('re-judges only the recorded threads and restores pass@k once every attempt is graded', async () => {
    const { completeThread, run, testCase, threadIds } = await setupTwoThreadCase();
    evaluate.mockResolvedValueOnce(verdict(true, 1));
    await completeThread(0);
    evaluate.mockResolvedValueOnce(judgeFailure('rate limited'));
    await completeThread(1);
    await runModel().update(run.id, { status: 'completed' });

    evaluate.mockResolvedValue(verdict(true, 1));
    const result = await service().rejudgeRun(run.id);

    expect(result).toEqual({ failedCases: 0, judgeErrorCases: 0, passedCases: 1, rejudged: 1 });
    expect(evaluate).toHaveBeenCalledTimes(4);
    expect(execAgent).not.toHaveBeenCalled();
    const runTopic = (await runTopicModel().findByRunAndTestCase(run.id, testCase.id))!;
    expect(runTopic.status).toBe('passed');
    expect(runTopic.passed).toBe(true);
    expect(runTopic.evalResult).toMatchObject({ passAllK: true, passAtK: true });
    expect(runTopic.evalResult?.judgeError).toBeUndefined();
    expect(runTopic.evalResult?.threads?.map((t) => t.threadId).sort()).toEqual(
      [...threadIds].sort(),
    );
    const recovered = runTopic.evalResult?.threads?.find((t) => t.threadId === threadIds[1]);
    expect(recovered).toMatchObject({ cost: 0.02, passed: true, status: 'passed' });
    expect(recovered?.judgeError).toBeUndefined();
    expect(runTopic.evalResult?.totalCost).toBeCloseTo(0.03);
    const metrics = (await runModel().findById(run.id))!.metrics!;
    expect(metrics).toMatchObject({ passAtK: 1, passRate: 1, passedCases: 1 });
    expect(metrics.judgeErrorCases).toBeUndefined();
  });
});

describe('recovering from judge failures', () => {
  it('re-judges the same trajectory, surviving repeated judge failures, without running the candidate', async () => {
    evaluate.mockResolvedValueOnce(judgeFailure('outage 1'));
    const { run, testCase, topic } = await completeSingleCase();
    await runModel().update(run.id, { status: 'completed' });

    evaluate.mockRejectedValueOnce(new Error('outage 2'));
    const stillBroken = await service().rejudgeRun(run.id);
    expect(stillBroken).toEqual({
      failedCases: 0,
      judgeErrorCases: 1,
      passedCases: 0,
      rejudged: 1,
    });
    let runTopic = (await runTopicModel().findByRunAndTestCase(run.id, testCase.id))!;
    expect(runTopic.status).toBe('judge_error');
    expect(runTopic.evalResult?.judgeError).toBe('Judge failed: outage 2');
    expect(runTopic.evalResult?.cost).toBe(0.02);

    evaluate.mockResolvedValueOnce(verdict(true, 1));
    const recovered = await service().rejudgeRun(run.id);
    expect(recovered).toEqual({ failedCases: 0, judgeErrorCases: 0, passedCases: 1, rejudged: 1 });
    runTopic = (await runTopicModel().findByRunAndTestCase(run.id, testCase.id))!;
    expect(runTopic.status).toBe('passed');
    expect(runTopic.passed).toBe(true);
    expect(runTopic.score).toBe(1);
    expect(runTopic.topicId).toBe(topic.id);
    expect(runTopic.evalResult).toMatchObject({ cost: 0.02, steps: 3, tokens: 120 });
    expect(runTopic.evalResult?.judgeError).toBeUndefined();
    expect(runTopic.evalResult?.errorPhase).toBeUndefined();
    expect(runTopic.evalResult?.rubricScores).toEqual([
      { reason: 'matches', rubricId: RUBRIC_ID, score: 1 },
    ]);

    expect(execAgent).not.toHaveBeenCalled();
    const updated = (await runModel().findById(run.id))!;
    expect(updated.metrics).toMatchObject({ averageScore: 1, passRate: 1, passedCases: 1 });
    expect(updated.metrics?.judgeErrorCases).toBeUndefined();
  });

  it('is never retried or resumed as if the candidate had failed', async () => {
    evaluate.mockResolvedValueOnce(judgeFailure('outage'));
    const { run, testCase, topic } = await completeSingleCase();
    await runModel().update(run.id, { status: 'completed' });

    await expect(service().retryErrorCases(run.id)).resolves.toEqual({ retryCount: 0 });
    await expect(service().retrySingleCase(run.id, testCase.id)).rejects.toThrow(
      'Cannot retry: the attempt ran but was not judged; re-judge it instead',
    );
    await expect(
      service().canResumeTrajectory({ runId: run.id, testCaseId: testCase.id }),
    ).resolves.toMatchObject({ canResume: false });
    await expect(service().getResumableCases(run.id)).resolves.toEqual([]);

    const [row] = await serverDB
      .select()
      .from(agentEvalRunTopics)
      .where(eq(agentEvalRunTopics.runId, run.id));
    expect(row.status).toBe('judge_error');
    expect(row.topicId).toBe(topic.id);
    expect((await runModel().findById(run.id))?.status).toBe('completed');
    expect(execAgent).not.toHaveBeenCalled();
  });
});

describe('evaluateAndFinalizeRun with judge errors', () => {
  it('counts them apart and keeps them out of failedCases and averageScore', async () => {
    const metrics = await service().evaluateAndFinalizeRun({
      run: { id: 'run-1' },
      runTopics: [
        {
          evalResult: { cost: 0.01 },
          passed: true,
          runId: 'run-1',
          score: 1,
          status: 'passed',
          topicId: 't1',
        },
        {
          evalResult: { cost: 0.01 },
          passed: false,
          runId: 'run-1',
          score: 0.2,
          status: 'failed',
          topicId: 't2',
        },
        {
          evalResult: { cost: 0.01, errorPhase: 'judge', judgeError: 'outage', rubricScores: [] },
          passed: null,
          runId: 'run-1',
          score: null,
          status: 'judge_error',
          topicId: 't3',
        },
      ],
    });

    expect(metrics).toMatchObject({
      averageScore: 0.6,
      errorCases: 0,
      failedCases: 1,
      judgeErrorCases: 1,
      passedCases: 1,
      totalCases: 3,
    });
    expect(metrics.passRate).toBeCloseTo(1 / 3);
    expect(metrics.totalCost).toBeCloseTo(0.03);
  });
});

describe('missing grading context', () => {
  it('records a missing dataset as judge_error instead of leaving the case running', async () => {
    const svc = service();
    vi.spyOn(depsOf(svc).datasetModel, 'findById').mockResolvedValue(undefined);

    const { done, runTopic } = await completeSingleCase(svc);

    expect(done.allDone).toBe(true);
    expect(runTopic.status).toBe('judge_error');
    expect(runTopic.passed).toBeNull();
    expect(runTopic.evalResult).toMatchObject({
      cost: 0.02,
      errorPhase: 'judge',
      judgeError: 'Grading context missing: dataset',
    });
    expect(evaluate).not.toHaveBeenCalled();
  });

  it('records a missing test case as judge_error on the topic path', async () => {
    const svc = service();
    const original = depsOf(svc).runTopicModel.findByRunAndTestCase;
    vi.spyOn(depsOf(svc).runTopicModel, 'findByRunAndTestCase').mockImplementationOnce(
      async (runId, testCaseId) => {
        const row = await original(runId, testCaseId);
        return row && { ...row, testCase: null };
      },
    );

    const { done, runTopic } = await completeSingleCase(svc);

    expect(done.allDone).toBe(true);
    expect(runTopic.status).toBe('judge_error');
    expect(runTopic.evalResult?.judgeError).toBe('Grading context missing: test case');
    expect(evaluate).not.toHaveBeenCalled();
  });

  it('records a missing test case as judge_error on the thread path, not as failed', async () => {
    const svc = service();
    const { completeThread, threadIds } = await setupTwoThreadCase(svc);
    // Look the case up by an id that does not exist: the real query returns no
    // row, which is the production shape of a deleted test case.
    const originalFindById = depsOf(svc).testCaseModel.findById;
    vi.spyOn(depsOf(svc).testCaseModel, 'findById').mockImplementation(() =>
      originalFindById('tc_missing'),
    );

    await completeThread(0);

    const thread = await new ThreadModel(serverDB, userId).findById(threadIds[0]);
    expect(thread?.metadata).toMatchObject({
      cost: 0.01,
      judgeError: 'Grading context missing: test case',
      status: 'judge_error',
    });
    expect(thread?.metadata).toHaveProperty('completedAt');
    expect((thread?.metadata as Record<string, unknown>).passed).toBeUndefined();
    expect(evaluate).not.toHaveBeenCalled();
  });
});

describe('pass@k threads whose judge throws', () => {
  it('still complete, so the case and the run finish instead of hanging', async () => {
    const { completeThread, run, testCase, threadIds } = await setupTwoThreadCase();
    evaluate.mockRejectedValue(new Error('judge down'));

    const first = await completeThread(0);
    expect(first.allThreadsDone).toBe(false);
    const second = await completeThread(1);
    expect(second).toEqual({ allRunDone: true, allThreadsDone: true });

    const threadModel = new ThreadModel(serverDB, userId);
    for (const threadId of threadIds) {
      const thread = await threadModel.findById(threadId);
      expect(thread?.metadata).toHaveProperty('completedAt');
      expect(thread?.metadata).toMatchObject({
        judgeError: 'Judge failed: judge down',
        status: 'judge_error',
      });
    }
    const runTopic = (await runTopicModel().findByRunAndTestCase(run.id, testCase.id))!;
    expect(runTopic.status).toBe('judge_error');
    expect(runTopic.evalResult?.completionReason).toBe('completed');
    expect(runTopic.evalResult?.totalCost).toBeCloseTo(0.03);
  });

  it('cannot be resumed: a judge failure is not a failed attempt', async () => {
    const { completeThread, run, testCase, threadIds } = await setupTwoThreadCase();
    evaluate.mockResolvedValueOnce(verdict(true, 1));
    await completeThread(0);
    evaluate.mockResolvedValueOnce(judgeFailure('rate limited'));
    await completeThread(1);
    await runModel().update(run.id, { status: 'running' });

    await expect(
      service().canResumeTrajectory({
        runId: run.id,
        testCaseId: testCase.id,
        threadId: threadIds[1],
      }),
    ).resolves.toEqual({ canResume: false, reason: 'Trajectory is not resumable' });
    await expect(service().getResumableCases(run.id)).resolves.toEqual([]);
    expect(execAgent).not.toHaveBeenCalled();
  });
});

describe('re-judging a run with mixed outcomes', () => {
  it('reports one verdict and one judge failure, matching the stored metrics', async () => {
    const { cases, run } = await setupMultiCaseRun(
      [{ assistantOutput: '42' }, { assistantOutput: '42' }],
      { datasetEvalMode: 'contains' },
    );
    evaluate.mockResolvedValue(verdict(true, 1));
    for (const { testCase } of cases) {
      await service().recordTrajectoryCompletion({
        runId: run.id,
        status: 'completed',
        telemetry: { completionReason: 'stop', cost: 0.01 },
        testCaseId: testCase.id,
      });
    }
    await runModel().update(run.id, { status: 'completed' });
    const before = await runTopicModel().findByRunId(run.id);
    expect(before.map((t) => t.status)).toEqual(['passed', 'passed']);

    evaluate.mockReset();
    evaluate.mockResolvedValueOnce(verdict(true, 1)).mockResolvedValueOnce(judgeFailure('outage'));
    const result = await service().rejudgeRun(run.id);

    expect(result).toEqual({ failedCases: 0, judgeErrorCases: 1, passedCases: 1, rejudged: 2 });
    const metrics = (await runModel().findById(run.id))!.metrics!;
    expect(metrics).toMatchObject({
      averageScore: 1,
      failedCases: 0,
      judgeErrorCases: 1,
      passRate: 0.5,
      passedCases: 1,
      totalCases: 2,
    });
    const after = await runTopicModel().findByRunId(run.id);
    expect(after.map((t) => t.status).sort()).toEqual(['judge_error', 'passed']);
    expect(after.map((t) => t.topicId).sort()).toEqual(before.map((t) => t.topicId).sort());
    for (const t of after) expect(t.evalResult?.cost).toBe(0.01);
    expect(execAgent).not.toHaveBeenCalled();
  });
});
