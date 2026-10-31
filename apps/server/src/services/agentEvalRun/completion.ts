import { evaluate } from '@lobechat/eval-rubric';
import type {
  EvalBenchmarkRubric,
  EvalRunMetrics,
  EvalRunTopicResult,
  RubricType,
} from '@lobechat/types';

import type { EvalRunDeps } from './types';
import { roundCost } from './utils';

export async function recordTrajectoryCompletion(
  deps: EvalRunDeps,
  params: {
    runId: string;
    status?: string;
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
  },
): Promise<{ allDone: boolean; completedCount: number }> {
  const { runId, testCaseId, telemetry, status } = params;

  // Write runtime telemetry to RunTopic
  const runTopic = await deps.runTopicModel.findByRunAndTestCase(runId, testCaseId);
  if (runTopic) {
    // Skip if topic is already in a terminal state (e.g. timeout marked by checkAndHandleRunTimeout).
    // The interrupted agent still fires the completion webhook, but we must not overwrite the result.
    const terminalStates = ['passed', 'failed', 'error', 'timeout', 'external'];
    if (runTopic.status && terminalStates.includes(runTopic.status)) {
      // Fall through to progress tracking below without modifying this topic
    } else {
      // Build merged evalResult with telemetry data — use this as base for all subsequent writes
      const evalResultWithTelemetry: EvalRunTopicResult = {
        ...runTopic.evalResult,
        completionReason: telemetry.completionReason,
        cost: telemetry.cost != null ? roundCost(telemetry.cost) : undefined,
        duration: telemetry.duration,
        llmCalls: telemetry.llmCalls,
        rubricScores: runTopic.evalResult?.rubricScores,
        steps: telemetry.steps,
        tokens: telemetry.totalTokens,
        toolCalls: telemetry.toolCalls,
      };

      await deps.runTopicModel.updateByRunAndTopic(runTopic.runId, runTopic.topicId, {
        evalResult: evalResultWithTelemetry,
      });

      if (status === 'error') {
        // Short-circuit: execution error — skip evaluation, write error directly
        await deps.runTopicModel.updateByRunAndTopic(runTopic.runId, runTopic.topicId, {
          evalResult: {
            ...evalResultWithTelemetry,
            error:
              telemetry.errorMessage ||
              `Execution error: ${telemetry.completionReason || 'unknown'}`,
            errorDetail: telemetry.errorDetail,
          },
          passed: false,
          score: 0,
          status: 'error',
        });
      } else {
        // Per-case evaluation: immediately evaluate this case against rubrics
        try {
          await evaluateCase(deps, runId, { ...runTopic, evalResult: evalResultWithTelemetry });
        } catch (e) {
          // Evaluation failure should not block telemetry or progress tracking
          console.error(e);
        }
      }
    }
  }

  // Get run to read totalCases
  const run = await deps.runModel.findById(runId);
  if (!run) return { allDone: false, completedCount: 0 };

  const totalCases = run.metrics?.totalCases;
  if (!totalCases) return { allDone: false, completedCount: 0 };

  // Aggregate real-time metrics from all RunTopics
  const allTopics = await deps.runTopicModel.findByRunId(runId);
  const completedCount = allTopics.filter(
    (t) =>
      (t.evalResult && 'completionReason' in t.evalResult) ||
      t.status === 'timeout' ||
      t.status === 'external',
  ).length;
  const passedCases = allTopics.filter((t) => t.status === 'passed').length;
  const failedCases = allTopics.filter((t) => t.status === 'failed').length;
  const errorCases = allTopics.filter((t) => t.status === 'error').length;
  const externalCasesTraj = allTopics.filter((t) => t.status === 'external').length;
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

  // Update run metrics with real-time counts
  await deps.runModel.update(runId, {
    metrics: {
      ...(run.metrics as EvalRunMetrics),
      completedCases: completedCount,
      cost: sumCost ? roundCost(sumCost) : undefined,
      errorCases,
      externalCases: externalCasesTraj || undefined,
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

  return { allDone: completedCount >= totalCases, completedCount };
}

async function evaluateCase(
  deps: EvalRunDeps,
  runId: string,
  runTopic: {
    evalResult?: EvalRunTopicResult | null;
    runId: string;
    testCase?: { content?: any; evalConfig?: any; evalMode?: string | null } | null;
    topicId: string;
  },
) {
  // Resolve eval context: run → dataset → benchmark
  const run = await deps.runModel.findById(runId);
  if (!run) return;

  const dataset = await deps.datasetModel.findById(run.datasetId);
  if (!dataset) return;

  const benchmark = dataset.benchmarkId
    ? await deps.benchmarkModel.findById(dataset.benchmarkId)
    : null;

  const passThreshold = (run.config?.passThreshold as number) ?? 0.6;
  const benchmarkRubrics = benchmark?.rubrics ?? [];

  // Get messages for this topic
  const messages = await deps.messageModel.query({ topicId: runTopic.topicId });
  const assistantMessages = messages.filter((m: { role: string }) => m.role === 'assistant');
  const lastAssistantMsg = assistantMessages.at(-1);

  const existingResult = runTopic.evalResult;

  if (!lastAssistantMsg || !lastAssistantMsg.content) {
    await deps.runTopicModel.updateByRunAndTopic(runTopic.runId, runTopic.topicId, {
      evalResult: { ...existingResult, error: 'No assistant output', rubricScores: [] },
      passed: false,
      score: 0,
      status: 'error',
    });
    return;
  }

  const testCase = runTopic.testCase;
  if (!testCase) return;

  // Resolve rubrics: TestCase evalMode > Dataset evalMode > Benchmark rubrics
  const evalMode = (testCase.evalMode ?? dataset.evalMode) as RubricType | null | undefined;
  const evalConfig = testCase.evalConfig ?? dataset.evalConfig;

  // ── External eval mode: agent finished, hand off to external scorer ──
  if (evalMode === 'external') {
    await deps.runTopicModel.updateByRunAndTopic(runTopic.runId, runTopic.topicId, {
      evalResult: { ...existingResult, awaitingExternalEval: true },
      status: 'external',
    });
    return;
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
    effectiveRubrics = benchmarkRubrics ?? [];
  }

  // No rubrics to evaluate against — skip evaluation entirely
  if (effectiveRubrics.length === 0) return;

  // Run evaluation
  const result = await evaluate(
    { actual: lastAssistantMsg.content, rubrics: effectiveRubrics, testCase: testCase.content },
    { passThreshold },
  );

  const evalResult: EvalRunTopicResult = {
    ...existingResult,
    rubricScores: result.rubricResults.map((r) => ({
      reason: r.reason,
      rubricId: r.rubricId,
      score: r.score,
    })),
  };

  // Write results to RunTopic
  await deps.runTopicModel.updateByRunAndTopic(runTopic.runId, runTopic.topicId, {
    evalResult,
    passed: result.passed,
    score: result.score,
    status: result.passed ? 'passed' : 'failed',
  });
}
