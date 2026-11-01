import { evaluate } from '@lobechat/eval-rubric';
import type {
  EvalBenchmarkRubric,
  EvalCaseEnvironment,
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

import {
  EVAL_AGENT_RUNTIME_QSTASH_RETRIES,
  EVAL_AGENT_RUNTIME_QSTASH_RETRY_DELAY,
  EVAL_HISTORY_TAIL_METADATA_KEY,
  THREAD_TRIGGER_CONCURRENCY,
} from './constants';
import { createEvalRunDeps } from './deps';
import type { EvalRunDeps } from './types';
import { getCaseId, getEvalContextParams, roundCost } from './utils';

const getThreadResultStatus = (
  evalResult: Record<string, unknown>,
): EvalThreadResult['status'] | undefined => {
  const { status } = evalResult;

  if (status === 'completed' || status === 'error' || status === 'external' || status === 'timeout')
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

  const topicId = runTopic.topicId;
  const topic = await deps.topicModel.findById(topicId);
  const historyTailMessageId = topic?.metadata?.[EVAL_HISTORY_TAIL_METADATA_KEY];
  const sourceMessageId =
    typeof historyTailMessageId === 'string' ? historyTailMessageId : undefined;

  // Update status from 'pending' to 'running'
  await deps.runTopicModel.updateByRunAndTopic(runId, topicId, { status: 'running' });

  // Create K threads in the topic
  const threadIds: string[] = [];
  for (let i = 0; i < k; i++) {
    const thread = await deps.threadModel.create({
      sourceMessageId,
      topicId,
      type: 'eval',
    });
    if (thread) threadIds.push(thread.id);
  }

  await deps.runTopicModel.updateByRunAndTopic(runId, topicId, {
    evalResult: {
      // Persist thread ids before fan-out so pass@k UIs can render attempts immediately.
      ...(runTopic.evalResult as EvalRunTopicResult | null),
      threads: threadIds.map((threadId) => ({
        status: 'running' as const,
        threadId,
      })),
    } satisfies EvalRunTopicResult,
  });

  // Trigger K run-thread-trajectory workflows with a bounded fan-out. Every
  // thread above is already persisted as running, so one failed dispatch must
  // not stop the rest from being attempted; the first failure is rethrown once
  // all triggers have settled, matching the previous Promise.all rejection.
  let firstTriggerError: { error: unknown } | undefined;
  await pMap(
    threadIds,
    async (threadId) => {
      try {
        await AgentEvalRunWorkflow.triggerRunThreadTrajectory({
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
  const caseId = getCaseId(params.testCase.metadata);

  const aiAgentService = new AiAgentService(deps.db, deps.userId, {
    workspaceId: deps.workspaceId,
  });
  const webhookUrl = '/api/workflows/agent-eval-run/on-thread-complete';
  const userId = deps.userId;
  const db = deps.db;

  try {
    const execResult = await aiAgentService.execAgent({
      agentId: run.targetAgentId ?? undefined,
      appContext: { threadId, topicId },
      autoStart: true,
      trigger: RequestTrigger.Eval,
      hooks: [
        {
          handler: async (event) => {
            // Local mode: directly record thread completion
            await recordThreadCompletion(createEvalRunDeps(db, userId, deps.workspaceId), {
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
            });
          },
          id: 'eval-thread-complete',
          type: 'onComplete' as const,
          webhook: {
            body: { runId, testCaseId, threadId, topicId, userId },
            delivery: 'qstash' as const,
            url: webhookUrl,
          },
        },
      ],
      ...getEvalContextParams(envPrompt, environment, caseId),
      maxSteps: run.config?.maxSteps,
      prompt: params.testCase.content.input || '',
      queueRetries: EVAL_AGENT_RUNTIME_QSTASH_RETRIES,
      queueRetryDelay: EVAL_AGENT_RUNTIME_QSTASH_RETRY_DELAY,
      userInterventionConfig: { approvalMode: 'headless' },
    });

    // Write operationId to thread metadata
    if (execResult?.operationId) {
      await deps.threadModel.update(threadId, {
        metadata: { operationId: execResult.operationId, testCaseId },
      } as any);
    }

    return { threadId, topicId };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Thread execution failed to start';
    console.error(
      `[run-thread-trajectory] execAgent failed for run=${runId} thread=${threadId}:`,
      error,
    );

    // Mark the thread explicitly as error; aggregation and resume-target selection rely on metadata.status.
    await deps.threadModel.update(threadId, {
      metadata: {
        completedAt: new Date().toISOString(),
        error: errorMessage,
        passed: false,
        score: 0,
        status: 'error',
        testCaseId,
      },
    } as any);

    return { error: errorMessage, threadId, topicId };
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

  // 1. Evaluate this thread's messages
  const evalResult = await evaluateThread(deps, {
    runId,
    status,
    telemetry,
    testCaseId,
    threadId,
    topicId,
  });

  // 2. Write eval result to thread.metadata
  await deps.threadModel.update(threadId, {
    metadata: {
      ...evalResult,
      completedAt: new Date().toISOString(),
      // Normalize status into metadata so later aggregation can reconstruct threads[] consistently.
      status: getThreadResultStatus(evalResult),
      testCaseId,
    },
  } as any);

  // 3. Check if all K threads for this topic are done
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
    runId,
    testCaseId,
    topicId,
  });

  // 5. Check if the entire run is done (same as recordTrajectoryCompletion)
  const run = await deps.runModel.findById(runId);
  if (!run) return { allRunDone: false, allThreadsDone: true };

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

  await deps.runModel.update(runId, {
    metrics: {
      ...(run.metrics as EvalRunMetrics),
      completedCases: completedCount,
      cost: sumCost ? roundCost(sumCost) : undefined,
      errorCases,
      externalCases: externalCasesRT || undefined,
      failedCases,
      llmCalls: sumLlmCalls || undefined,
      passedCases,
      perCaseCost: sumCost && completedCount ? roundCost(sumCost / completedCount) : undefined,
      perCaseLlmCalls:
        sumLlmCalls && completedCount
          ? Math.round((sumLlmCalls / completedCount) * 10) / 10
          : undefined,
      perCaseSteps:
        sumSteps && completedCount ? Math.round((sumSteps / completedCount) * 10) / 10 : undefined,
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
  });

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
  },
): Promise<Record<string, unknown>> {
  const { runId, status, telemetry, testCaseId, threadId } = params;

  const baseMeta: Record<string, unknown> = {
    completionReason: telemetry.completionReason,
    cost: telemetry.cost != null ? roundCost(telemetry.cost) : undefined,
    duration: telemetry.duration,
    llmCalls: telemetry.llmCalls,
    steps: telemetry.steps,
    tokens: telemetry.totalTokens,
    toolCalls: telemetry.toolCalls,
  };

  // Error case — skip evaluation
  if (status === 'error') {
    return {
      ...baseMeta,
      error:
        telemetry.errorMessage || `Execution error: ${telemetry.completionReason || 'unknown'}`,
      errorDetail: telemetry.errorDetail,
      passed: false,
      score: 0,
    };
  }

  // Load run → dataset → benchmark for rubrics
  const run = await deps.runModel.findById(runId);
  if (!run) return { ...baseMeta, error: 'Run not found', passed: false, score: 0 };

  const dataset = await deps.datasetModel.findById(run.datasetId);
  if (!dataset) return { ...baseMeta, error: 'Dataset not found', passed: false, score: 0 };

  // A dataset need not belong to a benchmark; such a dataset simply
  // contributes no benchmark-level rubrics, and scoring falls back to the
  // per-case / per-dataset evalMode. Bailing here would leave every case in a
  // captured dataset permanently unscored.
  const benchmark = dataset.benchmarkId
    ? await deps.benchmarkModel.findById(dataset.benchmarkId)
    : null;

  const testCase = await deps.testCaseModel.findById(testCaseId);
  if (!testCase) return { ...baseMeta, error: 'Test case not found', passed: false, score: 0 };

  const passThreshold = (run.config?.passThreshold as number) ?? 0.6;

  // Get messages for this thread
  const messages = await deps.messageModel.query({ threadId, topicId: params.topicId });
  const assistantMessages = messages.filter((m: { role: string }) => m.role === 'assistant');
  const lastAssistantMsg = assistantMessages.at(-1);

  if (!lastAssistantMsg || !lastAssistantMsg.content) {
    return {
      ...baseMeta,
      error: 'No assistant output',
      passed: false,
      rubricScores: [],
      score: 0,
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
    effectiveRubrics = [
      {
        config: (evalConfig ?? {}) as unknown as EvalBenchmarkRubric['config'],
        id: `eval-mode-${evalMode}`,
        name: evalMode,
        type: evalMode,
        weight: 1,
      },
    ];
  } else {
    effectiveRubrics = benchmark?.rubrics ?? [];
  }

  // Run evaluation
  const result = await evaluate(
    { actual: lastAssistantMsg.content, rubrics: effectiveRubrics, testCase: testCase.content },
    { passThreshold },
  );

  return {
    ...baseMeta,
    passed: result.passed,
    rubricScores: result.rubricResults.map((r) => ({
      reason: r.reason,
      rubricId: r.rubricId,
      score: r.score,
    })),
    score: result.score,
  };
}

/**
 * Aggregate all completed thread results into RunTopic.
 * Writes threads[] array, plus top-level score/passed using pass@k logic.
 */
async function aggregateThreadResults(
  deps: EvalRunDeps,
  params: {
    completedThreads: Array<{ id: string; metadata?: Record<string, unknown> | null }>;
    runId: string;
    testCaseId: string;
    topicId: string;
  },
) {
  const { completedThreads, runId, topicId } = params;

  // Build threads array from metadata
  const threadResults: Array<{
    completionReason?: string;
    cost?: number;
    duration?: number;
    error?: string;
    llmCalls?: number;
    passed?: boolean;
    rubricScores?: Array<{ reason?: string; rubricId: string; score: number }>;
    score?: number;
    status?: 'error' | 'external' | 'failed' | 'passed' | 'running' | 'timeout';
    steps?: number;
    threadId: string;
    tokens?: number;
    toolCalls?: number;
  }> = completedThreads.map((t) => {
    const meta = (t.metadata ?? {}) as Record<string, unknown>;
    return {
      completionReason: meta.completionReason as string | undefined,
      cost: meta.cost as number | undefined,
      duration: meta.duration as number | undefined,
      error: meta.error as string | undefined,
      llmCalls: meta.llmCalls as number | undefined,
      passed: meta.passed as boolean | undefined,
      rubricScores: meta.rubricScores as any,
      score: meta.score as number | undefined,
      status: meta.status as
        'error' | 'external' | 'failed' | 'passed' | 'running' | 'timeout' | undefined,
      steps: meta.steps as number | undefined,
      threadId: t.id,
      tokens: meta.tokens as number | undefined,
      toolCalls: meta.toolCalls as number | undefined,
    };
  });

  // ── External eval mode: if all threads await external scoring, propagate that status ──
  const allExternal = threadResults.every((t) => t.status === 'external');
  if (allExternal) {
    await deps.runTopicModel.updateByRunAndTopic(runId, topicId, {
      evalResult: {
        awaitingExternalEval: true,
        completionReason: 'external',
        threads: threadResults,
      } satisfies EvalRunTopicResult,
      status: 'external',
    });
    return;
  }

  // pass@k: at least one thread passed
  const anyPassed = threadResults.some((t) => t.passed === true);
  // pass^k: all threads passed
  const allPassed = threadResults.every((t) => t.passed === true);

  // Best score (used as the representative score)
  const scores = threadResults.filter((t) => t.score != null).map((t) => t.score!);
  const bestScore = scores.length > 0 ? Math.max(...scores) : 0;

  // Aggregate metrics as totals across K threads
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

  // Compute per-case averages (primary fields = avg)
  const k = threadResults.length;

  // The topic-level completionReason: use "completed" if any succeeded
  const completionReason = anyPassed ? 'completed' : 'failed';

  // Write aggregated result to RunTopic
  // Primary fields (cost/tokens/duration/steps/llmCalls/toolCalls) = average per execution
  // total* fields = cumulative across K threads
  await deps.runTopicModel.updateByRunAndTopic(runId, topicId, {
    evalResult: {
      completionReason,
      cost: totalCost ? roundCost(totalCost / k) : undefined,
      duration: totalDuration ? totalDuration / k : undefined,
      llmCalls: totalLlmCalls ? Math.round((totalLlmCalls / k) * 10) / 10 : undefined,
      passAllK: allPassed,
      passAtK: anyPassed,
      steps: totalSteps ? Math.round((totalSteps / k) * 10) / 10 : undefined,
      threads: threadResults,
      tokens: totalTokens ? totalTokens / k : undefined,
      toolCalls: totalToolCalls ? Math.round((totalToolCalls / k) * 10) / 10 : undefined,
      totalCost: totalCost ? roundCost(totalCost) : undefined,
      totalDuration: totalDuration || undefined,
      totalTokens: totalTokens || undefined,
    } satisfies EvalRunTopicResult,
    // pass@k: passed if any thread passed
    passed: anyPassed,
    score: bestScore,
    status: anyPassed ? 'passed' : 'failed',
  });
}
