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
import { agentEvalDatasets, agentEvalTestCases, messages, topics } from '@/database/schemas';
import { AgentEvalRunService } from '@/server/services/agentEvalRun';
import { AgentRuntimeService } from '@/server/services/agentRuntime/AgentRuntimeService';
import { AiAgentService } from '@/server/services/aiAgent';

import { cleanupDB, serverDB, setupEvalChain, userId } from './_setup';

/**
 * Execution errors on pass@k attempts (a provider without a key, a crash
 * before the first model call) must stay errors: a case whose every attempt
 * errored is an execution error of the run, not a model that failed the rules.
 */
const generateObject = vi.fn().mockResolvedValue({ score: 1 });
vi.mock('@/server/modules/AgentRuntime/llmRelay/oneShot', () => ({
  initModelRuntimeForRequest: vi.fn(async () => ({ generateObject })),
}));

const evaluate = vi.fn<(...args: unknown[]) => Promise<EvaluateResult>>();
vi.mock('@lobechat/eval-rubric', async (importOriginal) => ({
  ...(await importOriginal<typeof EvalRubric>()),
  evaluate: (...args: unknown[]) => evaluate(...args),
}));
vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn().mockImplementation(function () {
    return { execAgent: vi.fn() };
  }),
}));
vi.mock('@/server/services/agentRuntime/AgentRuntimeService', () => ({
  AgentRuntimeService: vi.fn().mockImplementation(function () {
    return { interruptOperation: vi.fn().mockResolvedValue(true) };
  }),
}));

const RUBRIC_ID = 'eval-mode-contains';
const passing: EvaluateResult = {
  passed: true,
  rubricResults: [{ passed: true, reason: 'matches', rubricId: RUBRIC_ID, score: 1 }],
  score: 1,
};

const runTopicModel = () => new AgentEvalRunTopicModel(serverDB, userId);
const runModel = () => new AgentEvalRunModel(serverDB, userId);

/** A k=2 case with two eval threads; `finish` reports one of them as completed or errored. */
const setupTwoThreadCase = async (svc: AgentEvalRunService) => {
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
  const finish = (index: number, outcome: 'completed' | 'error' | 'timeout') =>
    svc.recordThreadCompletion({
      runId: run.id,
      status: outcome,
      telemetry:
        outcome === 'error'
          ? { completionReason: 'error', duration: 200, errorMessage: 'InvalidProviderAPIKey' }
          : { completionReason: 'stop', cost: 0.01, duration: 1000, totalTokens: 50 },
      testCaseId: testCase.id,
      threadId: threadIds[index],
      topicId: topic.id,
    });
  return { finish, run, testCase, threadIds, topic };
};

beforeEach(async () => {
  await cleanupDB();
  vi.restoreAllMocks();
  evaluate.mockReset();
  generateObject.mockClear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('pass@k attempts that fail to execute', () => {
  it('records a case whose every attempt errored as an execution error, not a failed verdict', async () => {
    const svc = new AgentEvalRunService(serverDB, userId);
    const { finish, run, testCase, threadIds } = await setupTwoThreadCase(svc);

    await finish(0, 'error');
    const { allRunDone } = await finish(1, 'error');

    expect(allRunDone).toBe(true);
    expect(evaluate).not.toHaveBeenCalled();
    const runTopic = (await runTopicModel().findByRunAndTestCase(run.id, testCase.id))!;
    expect(runTopic.status).toBe('error');
    expect(runTopic.passed).toBeNull();
    const result = runTopic.evalResult as Record<string, any>;
    expect(result.completionReason).toBe('error');
    expect(result.error).toContain('InvalidProviderAPIKey');
    expect(result.error).toContain('2 of 2 attempts');
    expect(result.threads.map((t: any) => t.status)).toEqual(['error', 'error']);
    expect(result.threads.map((t: any) => t.threadId).sort()).toEqual([...threadIds].sort());

    const updated = (await runModel().findById(run.id))!;
    expect(updated.metrics?.errorCases).toBe(1);
    expect(updated.metrics?.failedCases).toBe(0);
    expect(updated.metrics?.passedCases).toBe(0);
  });

  it('keeps a mixed error/pass sample unranked and preserves both attempts', async () => {
    evaluate.mockResolvedValue(passing);
    const svc = new AgentEvalRunService(serverDB, userId);
    const { finish, run, testCase } = await setupTwoThreadCase(svc);

    await finish(0, 'error');
    await finish(1, 'completed');

    const runTopic = (await runTopicModel().findByRunAndTestCase(run.id, testCase.id))!;
    expect(runTopic.status).toBe('error');
    const result = runTopic.evalResult as Record<string, any>;
    expect(result.passAtK).toBeUndefined();
    expect(result.passAllK).toBeUndefined();
    expect(result.threads.map((t: any) => t.status).sort()).toEqual(['error', 'passed']);
    const updated = (await runModel().findById(run.id))!;
    expect(updated.metrics?.passedCases).toBe(0);
    expect(updated.metrics?.errorCases).toBe(1);
  });
});

describe('invalid output and Stop races', () => {
  it.each([false, true])('classifies empty output with hitStepCap=%s', async (hitStepCap) => {
    evaluate.mockResolvedValue(passing);
    const svc = new AgentEvalRunService(serverDB, userId);
    const { finish, run, testCase, threadIds, topic } = await setupTwoThreadCase(svc);
    await runModel().update(run.id, { config: { k: 2, maxSteps: 20 } });
    await serverDB.delete(messages).where(eq(messages.threadId, threadIds[0]));
    await svc.recordThreadCompletion({
      runId: run.id,
      status: 'completed',
      testCaseId: testCase.id,
      threadId: threadIds[0],
      topicId: topic.id,
      telemetry: { completionReason: 'stop', steps: hitStepCap ? 20 : 1 },
    });
    await finish(1, 'completed');
    const result = await runTopicModel().findByRunAndTestCase(run.id, testCase.id);
    expect(result?.status).toBe(hitStepCap ? 'passed' : 'error');
    const attempt = result?.evalResult?.threads?.find((item) => item.threadId === threadIds[0]);
    expect(attempt?.status).toBe(hitStepCap ? 'failed' : 'error');
    expect(attempt?.error).toContain(hitStepCap ? 'step limit' : 'No assistant output');
  });

  it('keeps a timeout mixed with a passed attempt out of model verdicts', async () => {
    evaluate.mockResolvedValue(passing);
    const svc = new AgentEvalRunService(serverDB, userId);
    const { finish, run, testCase } = await setupTwoThreadCase(svc);
    await finish(0, 'timeout');
    await finish(1, 'completed');
    const result = await runTopicModel().findByRunAndTestCase(run.id, testCase.id);
    expect(result).toMatchObject({ passed: null, score: null, status: 'timeout' });
    expect(result?.evalResult?.threads?.map((item) => item.status).sort()).toEqual([
      'passed',
      'timeout',
    ]);
    expect(result?.evalResult?.passAllK).toBeUndefined();
  });

  it('Stop wins when the Judge returns after the abort; stored evidence survives', async () => {
    const svc = new AgentEvalRunService(serverDB, userId);
    const { finish, run, testCase, threadIds, topic } = await setupTwoThreadCase(svc);
    await runTopicModel().updateByRunAndTopic(run.id, topic.id, {
      evalResult: {
        operationId: 'root',
        threads: [{ passed: true, status: 'passed', threadId: threadIds[0] }],
      },
    });
    await runTopicModel().updateThreadMetadata(run.id, topic.id, threadIds[1], {
      operationId: 'attempt',
      retained: 'audit',
    });
    let resolveJudge!: (value: EvaluateResult) => void;
    let reachedJudge!: () => void;
    const entered = new Promise<void>((resolve) => {
      reachedJudge = resolve;
    });
    evaluate.mockImplementation(() => {
      reachedJudge();
      return new Promise((resolve) => {
        resolveJudge = resolve;
      });
    });
    const finishing = finish(1, 'completed');
    await entered;
    await svc.abortRun(run.id);
    const stoppedThread = await new ThreadModel(serverDB, userId).findById(threadIds[1]);
    resolveJudge(passing);
    expect(await finishing).toMatchObject({ allRunDone: false });
    const result = await runTopicModel().findByRunAndTestCase(run.id, testCase.id);
    expect(result).toMatchObject({ passed: null, score: null, status: 'error' });
    expect(result?.evalResult).toMatchObject({
      completionReason: 'aborted',
      operationId: 'root',
      threads: expect.arrayContaining([expect.objectContaining({ passed: true })]),
    });
    const thread = await new ThreadModel(serverDB, userId).findById(threadIds[1]);
    expect(thread?.metadata).toMatchObject({ operationId: 'attempt', retained: 'audit' });
    expect(thread?.metadata).toEqual(stoppedThread?.metadata);
    expect(thread?.metadata).toMatchObject({
      status: 'error',
      error: 'Aborted',
      executionId: expect.any(String),
    });
    expect(await finish(0, 'completed')).toMatchObject({ allRunDone: false });
    expect(evaluate).toHaveBeenCalledTimes(1);
  });

  it('merges a late operation id without erasing a completed attempt', async () => {
    evaluate.mockResolvedValue(passing);
    const svc = new AgentEvalRunService(serverDB, userId);
    const { finish, run, threadIds, topic } = await setupTwoThreadCase(svc);
    await finish(0, 'completed');
    await runTopicModel().updateThreadMetadata(run.id, topic.id, threadIds[0], {
      operationId: 'late-id',
    });
    const thread = await new ThreadModel(serverDB, userId).findById(threadIds[0]);
    expect(thread?.metadata).toMatchObject({
      operationId: 'late-id',
      passed: true,
      status: 'passed',
    });
    expect(thread?.metadata).toHaveProperty('completedAt');
  });

  it('interrupts an operation whose startup only returns after Stop', async () => {
    const svc = new AgentEvalRunService(serverDB, userId);
    const { run, testCase, threadIds, topic } = await setupTwoThreadCase(svc);
    let resolveStart!: (value: { operationId: string }) => void;
    let started!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    vi.mocked(AiAgentService).mockImplementationOnce(function () {
      return {
        execAgent: () => {
          started();
          return new Promise((resolve) => {
            resolveStart = resolve;
          });
        },
      } as any;
    });
    const executing = svc.executeThreadTrajectory({
      run,
      runId: run.id,
      testCase,
      testCaseId: testCase.id,
      threadId: threadIds[0],
      topicId: topic.id,
    });
    await entered;
    await svc.abortRun(run.id);
    resolveStart({ operationId: 'late-operation' });
    await executing;
    const interrupted = vi
      .mocked(AgentRuntimeService)
      .mock.results.flatMap((result) =>
        result.value.interruptOperation.mock.calls.map(([id]: [string]) => id),
      );
    expect(interrupted).toContain('late-operation');
    const result = await runTopicModel().findByRunAndTestCase(run.id, testCase.id);
    expect(result?.evalResult?.completionReason).toBe('aborted');
  });
});

describe('actual Judge request provenance', () => {
  it.each([false, true])(
    'persists requested pairs for topic and thread grading with failure=%s',
    async (failure) => {
      const svc = new AgentEvalRunService(serverDB, userId);
      const requested = [{ model: 'selected-judge', provider: 'selected-provider' }];
      evaluate.mockImplementation(async (_input, options: any) => {
        for (let i = 0; i < 2; i++) {
          await options.matchContext.generateObject({
            messages: [],
            model: 'rubric-judge',
            provider: 'rubric-provider',
            schema: { type: 'object' },
          });
        }
        if (failure) throw new Error('Judge response could not be parsed');
        return passing;
      });
      const single = await setupEvalChain({
        assistantOutput: '42',
        datasetEvalMode: 'contains',
        totalCases: 1,
      });
      await runModel().update(single.run.id, {
        config: { judgeModel: 'selected-judge', judgeProvider: 'selected-provider' },
      });
      await svc.recordTrajectoryCompletion({
        runId: single.run.id,
        testCaseId: single.testCase.id,
        telemetry: { completionReason: 'stop' },
      });
      const singleResult = await runTopicModel().findByRunAndTestCase(
        single.run.id,
        single.testCase.id,
      );
      expect(singleResult?.status).toBe(failure ? 'judge_error' : 'passed');
      expect(singleResult?.evalResult?.judges).toEqual(requested);

      const multi = await setupTwoThreadCase(svc);
      await runModel().update(multi.run.id, {
        config: { k: 2, judgeModel: 'selected-judge', judgeProvider: 'selected-provider' },
      });
      await multi.finish(0, 'completed');
      await multi.finish(1, 'completed');
      const multiResult = await runTopicModel().findByRunAndTestCase(
        multi.run.id,
        multi.testCase.id,
      );
      expect(multiResult?.status).toBe(failure ? 'judge_error' : 'passed');
      expect(multiResult?.evalResult?.threads?.map((attempt) => attempt.judges)).toEqual([
        requested,
        requested,
      ]);
      expect(generateObject).toHaveBeenCalledTimes(6);
      expect(
        generateObject.mock.calls.every(([payload]) => payload.model === 'selected-judge'),
      ).toBe(true);
    },
  );
});
