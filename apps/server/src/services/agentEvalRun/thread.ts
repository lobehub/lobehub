import { evaluate, type EvaluateResult } from '@lobechat/eval-rubric';
import type {
  EvalBenchmarkRubric,
  EvalCaseEnvironment,
  EvalMemorySnapshot,
  EvalRunConfig,
  EvalRunMetrics,
  EvalRunTopicResult,
  EvalTestCaseMetadata,
  EvalThreadResult,
  RubricType,
} from '@lobechat/types';
import { RequestTrigger } from '@lobechat/types';
import pMap from 'p-map';

import { AiAgentService } from '@/server/services/aiAgent';
import { AgentEvalRunWorkflow } from '@/server/workflows/agentEvalRun';

import { contenderChatConfigOf, resolveTopicAgentId } from './caseAgent';
import {
  EVAL_AGENT_RUNTIME_QSTASH_RETRIES,
  EVAL_AGENT_RUNTIME_QSTASH_RETRY_DELAY,
  EVAL_HISTORY_TAIL_METADATA_KEY,
  THREAD_TRIGGER_CONCURRENCY,
} from './constants';
import { createEvalRunDeps } from './deps';
import {
  buildEvalModeRubric,
  buildJudgeEvidence,
  createJudgeMatchContext,
  resolveEvalJudge,
} from './judge';
import {
  GRADING_CONTEXT_MISSING,
  JUDGE_ERROR_STATUS,
  judgeDiagnostics,
  judgeFailureMessage,
  readJudgeError,
} from './judgeError';
import { interruptEvalOperations } from './runLifecycle';
import { prepareTrialMemory, snapshotTrialMemory } from './trialMemory';
import type { EvalRunDeps } from './types';
import { getCaseId, getEvalAttemptId, getEvalContextParams, roundCost } from './utils';

const getThreadResultStatus = (
  evalResult: Record<string, unknown>,
): EvalThreadResult['status'] | undefined => {
  const { status } = evalResult;

  if (
    status === 'completed' ||
    status === 'error' ||
    status === 'external' ||
    status === 'timeout' ||
    status === JUDGE_ERROR_STATUS
  )
    return status;

  if (evalResult.passed === true) return 'passed';
  if (evalResult.passed === false) return 'failed';

  return undefined;
};

/**
 * Execute a test case with K threads (for pass@k).
 * Creates K threads in the pre-existing topic, then triggers K run-thread-trajectory workflows.
 */
export async function executeMultiThreadTrajectory(
  deps: EvalRunDeps,
  params: {
    k: number;
    run: {
      config?: EvalRunConfig | null;
      datasetId: string;
      targetAgentId?: string | null;
    };
    runId: string;
    testCaseId: string;
  },
) {
  const { k, runId, testCaseId } = params;

  const runTopic = await deps.runTopicModel.findByRunAndTestCase(runId, testCaseId);
  if (!runTopic) {
    throw new Error(`RunTopic not found for run=${runId} testCase=${testCaseId}`);
  }

  if (runTopic.status && runTopic.status !== 'pending') return;

  const topicId = runTopic.topicId;
  const topic = await deps.topicModel.findById(topicId);
  const historyTailMessageId = topic?.metadata?.[EVAL_HISTORY_TAIL_METADATA_KEY];
  const sourceMessageId =
    typeof historyTailMessageId === 'string' ? historyTailMessageId : undefined;

  // Update status from 'pending' to 'running'
  const started = await deps.runTopicModel.updateByRunAndTopic(
    runId,
    topicId,
    {
      status: 'running',
    },
    { executionId: runTopic.evalResult?.executionId, status: 'pending' },
  );
  if (!started) return;

  // Create K threads in the topic
  const threadIds: string[] = [];
  for (let i = 0; i < k; i++) {
    const thread = await deps.threadModel.create({
      metadata: { executionId: crypto.randomUUID(), status: 'pending', testCaseId },
      sourceMessageId,
      topicId,
      type: 'eval',
    });
    if (thread) threadIds.push(thread.id);
  }

  const ready = await deps.runTopicModel.updateByRunAndTopic(
    runId,
    topicId,
    {
      evalResult: {
        // Persist thread ids before fan-out so pass@k UIs can render attempts immediately.
        ...(runTopic.evalResult as EvalRunTopicResult | null),
        threads: threadIds.map((threadId) => ({
          status: 'running' as const,
          threadId,
        })),
      } satisfies EvalRunTopicResult,
    },
    { executionId: runTopic.evalResult?.executionId },
  );

  if (!ready) return;

  // Trigger K run-thread-trajectory workflows with a bounded fan-out. Every
  // thread above is already persisted as running, so one failed dispatch must
  // not stop the rest from being attempted; the first failure is rethrown once
  // all triggers have settled, matching the previous Promise.all rejection.
  let firstTriggerError: { error: unknown } | undefined;
  await pMap(
    threadIds,
    async (threadId) => {
      try {
        const thread = await deps.threadModel.findById(threadId);
        await AgentEvalRunWorkflow.triggerRunThreadTrajectory({
          executionId: thread?.metadata?.executionId as string | undefined,
          runId,
          testCaseId,
          threadId,
          topicId,
          userId: deps.userId,
        });
      } catch (error) {
        firstTriggerError ??= { error };
      }
    },
    { concurrency: THREAD_TRIGGER_CONCURRENCY },
  );
  if (firstTriggerError) throw firstTriggerError.error;

  return { threadIds, topicId };
}

/**
 * Execute a single thread trajectory (for pass@k).
 * Calls execAgent with topicId + threadId, webhook points to on-thread-complete.
 */
export async function executeThreadTrajectory(
  deps: EvalRunDeps,
  params: {
    executionId?: string;
    envPrompt?: string;
    run: {
      config?: EvalRunConfig | null;
      targetAgentId?: string | null;
    };
    runId: string;
    testCase: {
      content: { input?: string };
      metadata?: EvalTestCaseMetadata | null;
      sortOrder?: number | null;
    };
    testCaseId: string;
    threadId: string;
    topicId: string;
    environment?: EvalCaseEnvironment;
  },
) {
  const { envPrompt, environment, run, runId, testCaseId, threadId, topicId } = params;
  const current = await deps.runTopicModel.findByRunAndTestCase(runId, testCaseId);
  if (
    !current ||
    current.topicId !== topicId ||
    current.evalResult?.completionReason === 'aborted' ||
    current.status === 'timeout'
  ) {
    return { threadId, topicId };
  }
  const executionId = crypto.randomUUID();
  const claimed = await deps.runTopicModel.claimExecution({
    executionId,
    expectedExecutionId: params.executionId,
    runId,
    testCaseId,
    threadId,
    topicId,
  });
  if (!claimed) return { threadId, topicId };
  const caseId = getCaseId(params.testCase.metadata);

  const aiAgentService = new AiAgentService(deps.db, deps.userId, {
    workspaceId: deps.workspaceId,
  });
  const webhookUrl = '/api/workflows/agent-eval-run/on-thread-complete';
  const userId = deps.userId;
  const db = deps.db;
  const bindOperation = async (operationId: string) => {
    const saved = await deps.runTopicModel.updateThreadMetadata(
      runId,
      topicId,
      threadId,
      { operationId, testCaseId },
      { executionId },
    );
    if (!saved) {
      await interruptEvalOperations(deps, [operationId]);
      throw new Error('Execution is no longer current');
    }
  };

  try {
    const memory = await prepareTrialMemory(deps, {
      environment,
      runId,
      testCaseId,
      threadId,
      topicId,
    });
    const execResult = await aiAgentService.execAgent({
      agentId: await resolveTopicAgentId(deps, topicId, run.targetAgentId),
      // Eval dialogue must not feed Agent Signal (feedback, self-iteration, Memory writes).
      appContext: { suppressSignal: true, threadId, topicId },
      autoStart: true,
      chatConfigOverride: contenderChatConfigOf(run),
      trigger: RequestTrigger.Eval,
      hooks: [
        {
          handler: async (event) => {
            // Local mode: directly record thread completion
            const { allRunDone } = await recordThreadCompletion(
              createEvalRunDeps(db, userId, deps.workspaceId),
              {
                executionId,
                runId,
                status: event.status || event.reason || 'done',
                telemetry: {
                  completionReason: event.reason,
                  cost: event.cost,
                  duration: event.duration,
                  errorMessage: event.errorMessage,
                  llmCalls: event.llmCalls,
                  steps: event.steps,
                  toolCalls: event.toolCalls,
                  totalTokens: event.totalTokens,
                },
                testCaseId,
                threadId,
                topicId,
              },
            );
            // Queue mode finalizes from the completion webhook; in-process runs
            // have only this handler, so the run must be finalized here.
            if (allRunDone) await AgentEvalRunWorkflow.triggerFinalizeRun({ runId, userId });
          },
          id: 'eval-thread-complete',
          type: 'onComplete' as const,
          webhook: {
            body: { executionId, runId, testCaseId, threadId, topicId, userId },
            delivery: 'qstash' as const,
            url: webhookUrl,
          },
        },
      ],
      ...getEvalContextParams(
        envPrompt,
        environment,
        caseId,
        memory,
        getEvalAttemptId({ runId, threadId, topicId }),
      ),
      onOperationCreated: bindOperation,
      maxSteps: run.config?.maxSteps,
      prompt: params.testCase.content.input || '',
      queueRetries: EVAL_AGENT_RUNTIME_QSTASH_RETRIES,
      queueRetryDelay: EVAL_AGENT_RUNTIME_QSTASH_RETRY_DELAY,
      userInterventionConfig: { approvalMode: 'headless' },
    });

    if (execResult?.operationId) await bindOperation(execResult.operationId);

    return { threadId, topicId };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Thread execution failed to start';
    console.error(
      `[run-thread-trajectory] execAgent failed for run=${runId} thread=${threadId}:`,
      error,
    );

    // Mark the thread explicitly as error; aggregation and resume-target selection rely on metadata.status.
    await deps.runTopicModel.updateThreadMetadata(
      runId,
      topicId,
      threadId,
      {
        completedAt: new Date().toISOString(),
        error: errorMessage,
        passed: false,
        score: 0,
        status: 'error',
        testCaseId,
      },
      { executionId },
    );

    return { error: errorMessage, executionId, threadId, topicId };
  }
}

/**
 * Record a single thread's completion (for pass@k).
 * Evaluates the thread's messages, writes result to thread.metadata,
 * then checks if all K threads are done. If so, aggregates into RunTopic.
 */
export async function recordThreadCompletion(
  deps: EvalRunDeps,
  params: {
    executionId?: string;
    runId: string;
    status: string;
    telemetry: {
      completionReason?: string;
      cost?: number;
      duration?: number;
      errorMessage?: string;
      llmCalls?: number;
      steps?: number;
      toolCalls?: number;
      totalTokens?: number;
    };
    testCaseId: string;
    threadId: string;
    topicId: string;
  },
): Promise<{ allRunDone: boolean; allThreadsDone: boolean }> {
  const { runId, testCaseId, threadId, topicId, telemetry, status } = params;
  const parent = await deps.runTopicModel.findByRunAndTestCase(runId, testCaseId);
  if (
    !parent ||
    parent.topicId !== topicId ||
    parent.evalResult?.completionReason === 'aborted' ||
    parent.status === 'timeout'
  ) {
    return { allRunDone: false, allThreadsDone: false };
  }

  const attempt = await deps.threadModel.findById(threadId);
  if (!attempt || attempt.metadata?.executionId !== params.executionId) {
    return { allRunDone: false, allThreadsDone: false };
  }
  // 1. The attempt is over: record what this thread's Memory holds (an errored
  //    thread is snapshotted once it completes after a resume).
  const memorySnapshot =
    status === 'error' || status === 'timeout'
      ? undefined
      : await snapshotTrialMemory(deps, { runId, testCaseId, threadId, topicId });

  // 2. Evaluate this thread's messages. A judge that throws before
  //    `evaluateThread` can record it is a judge failure, not a verdict.
  let evalResult: Record<string, unknown>;
  try {
    evalResult = await evaluateThread(deps, {
      memorySnapshot,
      runId,
      status,
      telemetry,
      testCaseId,
      threadId,
      topicId,
    });
  } catch (error) {
    console.error(error);
    evalResult = threadJudgeError(threadTelemetry(telemetry), judgeFailureMessage(error));
  }

  // 3. Write eval result to thread.metadata
  const saved = await deps.runTopicModel.updateThreadMetadata(
    runId,
    topicId,
    threadId,
    {
      ...evalResult,
      executionId: params.executionId,
      ...(memorySnapshot && { memorySnapshot }),
      completedAt: new Date().toISOString(),
      status: getThreadResultStatus(evalResult),
      testCaseId,
    },
    { executionId: params.executionId },
  );
  if (!saved) return { allRunDone: false, allThreadsDone: false };

  // 4. Check if all K threads for this topic are done
  const allThreads = await deps.threadModel.queryByTopicId(topicId);
  const evalThreads = allThreads.filter((t) => t.type === 'eval');
  const completedThreads = evalThreads.filter((t) => {
    const meta = t.metadata as Record<string, unknown> | null;
    return meta && 'completedAt' in meta;
  });

  const allThreadsDone = completedThreads.length >= evalThreads.length;

  if (!allThreadsDone) {
    return { allRunDone: false, allThreadsDone: false };
  }

  // 4. All K threads done — aggregate into RunTopic
  await aggregateThreadResults(deps, {
    completedThreads: evalThreads,
    expectedExecutionId: parent.evalResult?.executionId,
    runId,
    testCaseId,
    topicId,
  });

  // 5. Check if the entire run is done (same as recordTrajectoryCompletion)
  const run = await deps.runModel.findById(runId);
  if (!run || run.status === 'aborted') return { allRunDone: false, allThreadsDone: true };

  const totalCases = run.metrics?.totalCases;
  if (!totalCases) return { allRunDone: false, allThreadsDone: true };

  const allTopics = await deps.runTopicModel.findByRunId(runId);
  const completedCount = allTopics.filter(
    (t) => (t.evalResult && 'completionReason' in t.evalResult) || t.status === 'timeout',
  ).length;

  // Update run metrics
  const passedCases = allTopics.filter((t) => t.status === 'passed').length;
  const failedCases = allTopics.filter((t) => t.status === 'failed').length;
  const errorCases = allTopics.filter((t) => t.status === 'error').length;
  const externalCasesRT = allTopics.filter((t) => t.status === 'external').length;
  const timeoutCases = allTopics.filter((t) => t.status === 'timeout').length;
  const judgeErrorCases = allTopics.filter((t) => t.status === JUDGE_ERROR_STATUS).length;

  let sumCost = 0;
  let sumTokens = 0;
  let sumSteps = 0;
  let sumLlmCalls = 0;
  let sumToolCalls = 0;
  let actualTotalCost = 0;
  let actualTotalTokens = 0;
  let actualTotalDuration = 0;
  for (const t of allTopics) {
    const r = t.evalResult as Record<string, unknown> | null;
    if (r && ('completionReason' in r || t.status === 'timeout')) {
      if (typeof r.cost === 'number') sumCost += r.cost;
      if (typeof r.tokens === 'number') sumTokens += r.tokens;
      if (typeof r.steps === 'number') sumSteps += r.steps;
      if (typeof r.llmCalls === 'number') sumLlmCalls += r.llmCalls;
      if (typeof r.toolCalls === 'number') sumToolCalls += r.toolCalls;
      const rTotalCost =
        typeof r.totalCost === 'number' ? r.totalCost : typeof r.cost === 'number' ? r.cost : 0;
      const rTotalTokens =
        typeof r.totalTokens === 'number'
          ? r.totalTokens
          : typeof r.tokens === 'number'
            ? r.tokens
            : 0;
      const rTotalDuration =
        typeof r.totalDuration === 'number'
          ? r.totalDuration
          : typeof r.duration === 'number'
            ? r.duration
            : 0;
      actualTotalCost += rTotalCost;
      actualTotalTokens += rTotalTokens;
      actualTotalDuration += rTotalDuration;
    }
  }

  await deps.runModel.update(
    runId,
    {
      metrics: {
        ...(run.metrics as EvalRunMetrics),
        completedCases: completedCount,
        cost: sumCost ? roundCost(sumCost) : undefined,
        errorCases,
        externalCases: externalCasesRT || undefined,
        failedCases,
        judgeErrorCases: judgeErrorCases || undefined,
        llmCalls: sumLlmCalls || undefined,
        passedCases,
        perCaseCost: sumCost && completedCount ? roundCost(sumCost / completedCount) : undefined,
        perCaseLlmCalls:
          sumLlmCalls && completedCount
            ? Math.round((sumLlmCalls / completedCount) * 10) / 10
            : undefined,
        perCaseSteps:
          sumSteps && completedCount
            ? Math.round((sumSteps / completedCount) * 10) / 10
            : undefined,
        perCaseTokens:
          sumTokens && completedCount ? Math.round(sumTokens / completedCount) : undefined,
        perCaseToolCalls:
          sumToolCalls && completedCount
            ? Math.round((sumToolCalls / completedCount) * 10) / 10
            : undefined,
        steps: sumSteps || undefined,
        timeoutCases,
        tokens: sumTokens || undefined,
        toolCalls: sumToolCalls || undefined,
        totalCost: actualTotalCost ? roundCost(actualTotalCost) : undefined,
        totalDuration: actualTotalDuration || undefined,
        totalTokens: actualTotalTokens || undefined,
      },
    },
    { startedAt: run.startedAt },
  );

  return { allRunDone: completedCount >= totalCases, allThreadsDone: true };
}

/**
 * Evaluate a single thread's messages against rubrics.
 * Returns the eval result to write into thread.metadata.
 */
async function evaluateThread(
  deps: EvalRunDeps,
  params: {
    runId: string;
    status: string;
    telemetry: {
      completionReason?: string;
      cost?: number;
      duration?: number;
      errorDetail?: unknown;
      errorMessage?: string;
      llmCalls?: number;
      steps?: number;
      toolCalls?: number;
      totalTokens?: number;
    };
    testCaseId: string;
    threadId: string;
    topicId: string;
    /** The thread's isolated Memory as it ended, shown to the LLM judge. */
    memorySnapshot?: EvalMemorySnapshot;
  },
): Promise<Record<string, unknown>> {
  const { memorySnapshot, runId, status, telemetry, testCaseId, threadId } = params;

  const baseMeta = threadTelemetry(telemetry);

  // Error case — skip evaluation. The status is kept so the aggregation and the
  // UI tell an execution error (provider key, timeout, crash) from a model that
  // ran and failed the rules.
  if (status === 'error' || status === 'timeout') {
    return {
      ...baseMeta,
      error:
        telemetry.errorMessage || `Execution error: ${telemetry.completionReason || 'unknown'}`,
      errorDetail: telemetry.errorDetail,
      passed: false,
      score: 0,
      status,
    };
  }

  // Load run → dataset → benchmark for rubrics. Missing grading context is a
  // judge problem: the thread keeps its attempt and is re-judged, not failed.
  const run = await deps.runModel.findById(runId);
  if (!run) return threadJudgeError(baseMeta, GRADING_CONTEXT_MISSING.run);

  const dataset = await deps.datasetModel.findById(run.datasetId);
  if (!dataset) return threadJudgeError(baseMeta, GRADING_CONTEXT_MISSING.dataset);

  // A dataset need not belong to a benchmark; such a dataset simply
  // contributes no benchmark-level rubrics, and scoring falls back to the
  // per-case / per-dataset evalMode. Bailing here would leave every case in a
  // captured dataset permanently unscored.
  const benchmark = dataset.benchmarkId
    ? await deps.benchmarkModel.findById(dataset.benchmarkId)
    : null;

  const testCase = await deps.testCaseModel.findById(testCaseId);
  if (!testCase) return threadJudgeError(baseMeta, GRADING_CONTEXT_MISSING.testCase);

  const passThreshold = (run.config?.passThreshold as number) ?? 0.6;

  // Get messages for this thread
  const messages = await deps.messageModel.query({ threadId, topicId: params.topicId });
  const assistantMessages = messages.filter((m: { role: string }) => m.role === 'assistant');
  const lastAssistantMsg = assistantMessages.at(-1);

  if (!lastAssistantMsg || !lastAssistantMsg.content) {
    // Same reading as the topic path: running into the step cap without an
    // answer is the model's outcome, not an infrastructure error.
    const stepCap = run.config?.maxSteps as number | undefined;
    const hitStepCap = !!stepCap && (telemetry.steps ?? 0) >= stepCap;
    return {
      ...baseMeta,
      error: hitStepCap
        ? `Reached the step limit (${stepCap}) without a final answer`
        : 'No assistant output',
      passed: false,
      rubricScores: [],
      score: 0,
      status: hitStepCap ? 'failed' : 'error',
    };
  }

  // Resolve rubrics
  const evalMode = (testCase.evalMode ?? dataset.evalMode) as RubricType | null | undefined;
  const evalConfig = testCase.evalConfig ?? dataset.evalConfig;

  // ── External eval mode: agent finished, hand off to external scorer ──
  if (evalMode === 'external') {
    return {
      ...baseMeta,
      awaitingExternalEval: true,
      passed: undefined,
      score: undefined,
      status: 'external',
    };
  }

  let effectiveRubrics: EvalBenchmarkRubric[];
  if (evalMode) {
    effectiveRubrics = [buildEvalModeRubric(evalMode, evalConfig)];
  } else {
    effectiveRubrics = benchmark?.rubrics ?? [];
  }

  // Run evaluation. A judge that fails (throws, or reports `judgeError`)
  // leaves the thread `judge_error` with its diagnostics; the thread's own
  // output and telemetry stay, and a re-judge grades it again.
  let result: EvaluateResult;
  try {
    const judge = await resolveEvalJudge(deps, {
      benchmarkMetadata: benchmark?.metadata,
      evalConfigs: [testCase.evalConfig, dataset.evalConfig],
      runConfig: run.config,
    });
    const topic = await deps.topicModel.findById(params.topicId);
    const historyTail = topic?.metadata?.[EVAL_HISTORY_TAIL_METADATA_KEY];
    const evidence = buildJudgeEvidence({
      historyTailMessageId: typeof historyTail === 'string' ? historyTail : undefined,
      memorySnapshot,
      messages,
    });
    const matchContext = createJudgeMatchContext(deps, judge, evidence);
    baseMeta.judges = matchContext.judgeRequests;
    result = await evaluate(
      { actual: lastAssistantMsg.content, rubrics: effectiveRubrics, testCase: testCase.content },
      { matchContext, passThreshold },
    );
  } catch (error) {
    // The stored message is replaced by the next re-judge, so the server log
    // is the only place the first failure's cause survives.
    console.error(
      `[eval-judge] Judge failed for run ${params.runId} topic ${params.topicId}:`,
      error,
    );
    return threadJudgeError(baseMeta, judgeFailureMessage(error));
  }
  const judgeError = readJudgeError(result);
  if (judgeError) {
    console.error(
      `[eval-judge] Judge reported an error for run ${params.runId} topic ${params.topicId}: ${judgeError}`,
    );
    return threadJudgeError(baseMeta, judgeError, result);
  }

  return {
    ...baseMeta,
    // A verdict replaces any earlier judge failure of this thread.
    judgeError: undefined,
    passed: result.passed,
    rubricScores: result.rubricResults.map((r) => ({
      reason: r.reason,
      rubricId: r.rubricId,
      score: r.score,
      ...(r.verdicts && { verdicts: r.verdicts }),
    })),
    score: result.score,
  };
}

const threadTelemetry = (telemetry: {
  completionReason?: string;
  cost?: number;
  duration?: number;
  llmCalls?: number;
  steps?: number;
  toolCalls?: number;
  totalTokens?: number;
}): Record<string, unknown> => ({
  completionReason: telemetry.completionReason,
  cost: telemetry.cost != null ? roundCost(telemetry.cost) : undefined,
  duration: telemetry.duration,
  llmCalls: telemetry.llmCalls,
  steps: telemetry.steps,
  tokens: telemetry.totalTokens,
  toolCalls: telemetry.toolCalls,
});

/** Thread metadata for an attempt whose grading failed: no verdict, diagnostics kept. */
const threadJudgeError = (
  baseMeta: Record<string, unknown>,
  judgeError: string,
  result?: EvaluateResult,
): Record<string, unknown> => ({
  ...baseMeta,
  judgeError,
  passed: undefined,
  rubricScores: judgeDiagnostics(result),
  score: undefined,
  status: JUDGE_ERROR_STATUS,
});

const REJUDGEABLE_THREAD_STATUSES = new Set(['passed', 'failed', JUDGE_ERROR_STATUS]);

/**
 * Grades every judged thread of a pass@k case again with the current judge
 * setup, from the messages and Memory snapshot it recorded, then rebuilds the
 * case's aggregate. Threads without a verdict (errors, timeouts) are kept.
 */
export async function rejudgeTopicThreads(
  deps: EvalRunDeps,
  params: { runId: string; testCaseId: string; topicId: string },
): Promise<number> {
  const { runId, testCaseId, topicId } = params;
  const parent = await deps.runTopicModel.findByRunAndTestCase(runId, testCaseId);
  const evalThreads = (await deps.threadModel.queryByTopicId(topicId)).filter(
    (thread) => thread.type === 'eval',
  );
  let rejudged = 0;

  for (const thread of evalThreads) {
    const meta = (thread.metadata ?? {}) as Record<string, unknown>;
    if (!('completedAt' in meta) || !REJUDGEABLE_THREAD_STATUSES.has(String(meta.status))) {
      continue;
    }
    const evalResult = await evaluateThread(deps, {
      memorySnapshot: meta.memorySnapshot as EvalMemorySnapshot | undefined,
      runId,
      status: 'completed',
      telemetry: {
        completionReason: meta.completionReason as string | undefined,
        cost: meta.cost as number | undefined,
        duration: meta.duration as number | undefined,
        llmCalls: meta.llmCalls as number | undefined,
        steps: meta.steps as number | undefined,
        toolCalls: meta.toolCalls as number | undefined,
        totalTokens: meta.tokens as number | undefined,
      },
      testCaseId,
      threadId: thread.id,
      topicId,
    });
    await deps.runTopicModel.updateThreadMetadata(
      runId,
      topicId,
      thread.id,
      { ...meta, ...evalResult, status: getThreadResultStatus(evalResult) },
      { executionId: meta.executionId as string | undefined },
    );
    rejudged++;
  }

  const completedThreads = (await deps.threadModel.queryByTopicId(topicId)).filter((thread) => {
    const meta = thread.metadata as Record<string, unknown> | null;
    return thread.type === 'eval' && meta && 'completedAt' in meta;
  });
  await aggregateThreadResults(deps, {
    completedThreads,
    expectedExecutionId: parent?.evalResult?.executionId,
    runId,
    testCaseId,
    topicId,
  });
  return rejudged;
}

/**
 * Aggregate all completed thread results into RunTopic.
 * Writes threads[] array, plus top-level score/passed using pass@k logic.
 */
async function aggregateThreadResults(
  deps: EvalRunDeps,
  params: {
    expectedExecutionId?: string;
    completedThreads: Array<{ id: string; metadata?: Record<string, unknown> | null }>;
    runId: string;
    testCaseId: string;
    topicId: string;
  },
) {
  const { completedThreads, runId, topicId } = params;

  // Build threads array from metadata
  const threadResults: Array<{
    executionId?: string;
    completionReason?: string;
    cost?: number;
    duration?: number;
    error?: string;
    judgeError?: string;
    judges?: EvalThreadResult['judges'];
    llmCalls?: number;
    memorySnapshot?: EvalMemorySnapshot;
    operationId?: string;
    passed?: boolean;
    rubricScores?: Array<{ reason?: string; rubricId: string; score: number }>;
    score?: number;
    status?: EvalThreadResult['status'];
    steps?: number;
    threadId: string;
    tokens?: number;
    toolCalls?: number;
  }> = completedThreads.map((t) => {
    const meta = (t.metadata ?? {}) as Record<string, unknown>;
    return {
      executionId: meta.executionId as string | undefined,
      completionReason: meta.completionReason as string | undefined,
      cost: meta.cost as number | undefined,
      duration: meta.duration as number | undefined,
      error: meta.error as string | undefined,
      judgeError: meta.judgeError as string | undefined,
      judges: meta.judges as EvalThreadResult['judges'],
      llmCalls: meta.llmCalls as number | undefined,
      // The attempt's Memory at the end, so a per-thread view can show it
      // without reading thread.metadata.
      memorySnapshot: meta.memorySnapshot as EvalMemorySnapshot | undefined,
      operationId: meta.operationId as string | undefined,
      passed: meta.passed as boolean | undefined,
      rubricScores: meta.rubricScores as any,
      score: meta.score as number | undefined,
      status: meta.status as EvalThreadResult['status'],
      steps: meta.steps as number | undefined,
      threadId: t.id,
      tokens: meta.tokens as number | undefined,
      toolCalls: meta.toolCalls as number | undefined,
    };
  });

  // Any invalid attempt makes the complete k-attempt estimate unavailable.
  // Preserve successful attempts and all failure reasons without awarding a
  // model verdict to the incomplete sample.
  const errored = threadResults.filter(
    (t) => t.status === 'error' || t.status === 'timeout' || t.error === 'No assistant output',
  );
  if (errored.length > 0) {
    const status = errored.some((t) => t.status !== 'timeout') ? 'error' : 'timeout';
    const messages = [
      ...new Set(
        errored.map(
          (t) => t.error ?? (t.status === 'timeout' ? 'Execution timeout' : 'Execution error'),
        ),
      ),
    ];
    await deps.runTopicModel.updateByRunAndTopic(
      runId,
      topicId,
      {
        evalResult: {
          executionId: params.expectedExecutionId,
          completionReason: status,
          error: `${errored.length} of ${threadResults.length} attempts failed to execute: ${messages.join('; ')}`,
          threads: threadResults,
          ...sumThreadTotals(threadResults),
        } satisfies EvalRunTopicResult,
        passed: null,
        score: null,
        status,
      },
      { executionId: params.expectedExecutionId },
    );
    return;
  }

  // ── A thread the judge could not grade: the case has no verdict yet. pass@k
  //    and pass^k are unknown until every thread is judged, so nothing is
  //    aggregated into passed/failed; the totals and per-thread results stay. ──
  const unjudged = threadResults.filter((t) => t.status === JUDGE_ERROR_STATUS);
  if (unjudged.length > 0) {
    const totals = sumThreadTotals(threadResults);
    await deps.runTopicModel.updateByRunAndTopic(
      runId,
      topicId,
      {
        evalResult: {
          executionId: params.expectedExecutionId,
          completionReason: 'completed',
          errorPhase: 'judge',
          judgeError: `${unjudged.length} of ${threadResults.length} attempts could not be judged: ${unjudged
            .map((t) => t.judgeError ?? 'judge failed')
            .join('; ')}`,
          threads: threadResults,
          ...totals,
        } satisfies EvalRunTopicResult,
        passed: null,
        score: null,
        status: JUDGE_ERROR_STATUS,
      },
      { executionId: params.expectedExecutionId },
    );
    return;
  }

  // ── External eval mode: if all threads await external scoring, propagate that status ──
  const hasExternal = threadResults.some((t) => t.status === 'external');
  if (hasExternal) {
    await deps.runTopicModel.updateByRunAndTopic(
      runId,
      topicId,
      {
        evalResult: {
          executionId: params.expectedExecutionId,
          awaitingExternalEval: true,
          completionReason: 'external',
          threads: threadResults,
        } satisfies EvalRunTopicResult,
        status: 'external',
      },
      { executionId: params.expectedExecutionId },
    );
    return;
  }

  // pass@k: at least one thread passed
  const anyPassed = threadResults.some((t) => t.passed === true);
  // pass^k: all threads passed
  const allPassed = threadResults.every((t) => t.passed === true);

  // Best score (used as the representative score)
  const scores = threadResults.filter((t) => t.score != null).map((t) => t.score!);
  const bestScore = scores.length > 0 ? Math.max(...scores) : 0;

  // The topic-level completionReason: use "completed" if any succeeded
  const completionReason = anyPassed ? 'completed' : 'failed';

  // Write aggregated result to RunTopic
  // Primary fields (cost/tokens/duration/steps/llmCalls/toolCalls) = average per execution
  // total* fields = cumulative across K threads
  await deps.runTopicModel.updateByRunAndTopic(
    runId,
    topicId,
    {
      evalResult: {
        executionId: params.expectedExecutionId,
        completionReason,
        passAllK: allPassed,
        passAtK: anyPassed,
        threads: threadResults,
        ...sumThreadTotals(threadResults),
      } satisfies EvalRunTopicResult,
      // pass@k: passed if any thread passed
      passed: anyPassed,
      score: bestScore,
      status: anyPassed ? 'passed' : 'failed',
    },
    { executionId: params.expectedExecutionId },
  );
}

/** Per-execution averages (primary fields) and cumulative totals across the K threads. */
const sumThreadTotals = (
  threadResults: Array<{
    cost?: number;
    duration?: number;
    llmCalls?: number;
    steps?: number;
    tokens?: number;
    toolCalls?: number;
  }>,
) => {
  let totalCost = 0;
  let totalDuration = 0;
  let totalTokens = 0;
  let totalSteps = 0;
  let totalLlmCalls = 0;
  let totalToolCalls = 0;
  for (const t of threadResults) {
    if (t.cost) totalCost += t.cost;
    if (t.duration) totalDuration += t.duration;
    if (t.tokens) totalTokens += t.tokens;
    if (t.steps) totalSteps += t.steps;
    if (t.llmCalls) totalLlmCalls += t.llmCalls;
    if (t.toolCalls) totalToolCalls += t.toolCalls;
  }
  const k = Math.max(threadResults.length, 1);
  return {
    cost: totalCost ? roundCost(totalCost / k) : undefined,
    duration: totalDuration ? totalDuration / k : undefined,
    llmCalls: totalLlmCalls ? Math.round((totalLlmCalls / k) * 10) / 10 : undefined,
    steps: totalSteps ? Math.round((totalSteps / k) * 10) / 10 : undefined,
    tokens: totalTokens ? totalTokens / k : undefined,
    toolCalls: totalToolCalls ? Math.round((totalToolCalls / k) * 10) / 10 : undefined,
    totalCost: totalCost ? roundCost(totalCost) : undefined,
    totalDuration: totalDuration || undefined,
    totalTokens: totalTokens || undefined,
  };
};
