import { evaluate, type EvaluateResult } from '@lobechat/eval-rubric';
import type {
  EvalBenchmarkRubric,
  EvalRunMetrics,
  EvalRunTopicResult,
  RubricType,
} from '@lobechat/types';

import { EVAL_HISTORY_TAIL_METADATA_KEY } from './constants';
import { classifyEmptyAnswer } from './emptyAnswer';
import {
  attemptReply,
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
import { runProgressOf } from './progress';
import { refillQueuedCases } from './queue';
import { withSubAgentMessages } from './subAgentEvidence';
import { snapshotTrialMemory } from './trialMemory';
import type { EvalRunDeps } from './types';
import { roundCost } from './utils';

export async function recordTrajectoryCompletion(
  deps: EvalRunDeps,
  params: {
    executionId?: string;
    topicId?: string;
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
  if (
    runTopic &&
    ((params.topicId && params.topicId !== runTopic.topicId) ||
      runTopic.evalResult?.executionId !== params.executionId)
  ) {
    return { allDone: false, completedCount: 0 };
  }
  if (runTopic) {
    // Skip if topic is already in a terminal state (e.g. timeout marked by checkAndHandleRunTimeout).
    // The interrupted agent still fires the completion webhook, but we must not overwrite the result.
    const terminalStates = ['passed', 'failed', 'error', 'timeout', 'external', JUDGE_ERROR_STATUS];
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

      await writeCompletion(deps, runTopic, {
        evalResult: evalResultWithTelemetry,
      });

      if (status === 'error') {
        // Short-circuit: execution error — skip evaluation, write error directly
        await writeCompletion(deps, runTopic, {
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
        // The attempt is over: record what its Memory holds. (An errored
        // attempt is snapshotted when it completes after a resume.)
        const memorySnapshot = await snapshotTrialMemory(deps, {
          runId,
          testCaseId,
          topicId: runTopic.topicId,
        });
        const evalResult = memorySnapshot
          ? { ...evalResultWithTelemetry, memorySnapshot }
          : evalResultWithTelemetry;
        if (memorySnapshot) {
          await writeCompletion(deps, runTopic, {
            evalResult,
          });
        }

        // Per-case evaluation: immediately evaluate this case against rubrics.
        // A judge that throws before `evaluateCase` can record it (judge
        // resolution, message lookup) is still a judge failure, not a verdict.
        try {
          await evaluateCase(deps, runId, { ...runTopic, evalResult });
        } catch (error) {
          console.error(error);
          await writeTopicJudgeError(deps, runTopic, evalResult, judgeFailureMessage(error));
        }
      }
    }
  }

  // Get run to read totalCases
  const run = await deps.runModel.findById(runId);
  if (!run || run.status === 'aborted') return { allDone: false, completedCount: 0 };

  const totalCases = run.metrics?.totalCases;
  if (!totalCases) return { allDone: false, completedCount: 0 };

  // Aggregate real-time metrics from all RunTopics
  const allTopics = await deps.runTopicModel.findByRunId(runId);
  const progress = runProgressOf(allTopics);
  const completedCount = progress.completedCases ?? 0;

  // Update run metrics with real-time counts
  await deps.runModel.updateProgress(
    runId,
    { ...(run.metrics as EvalRunMetrics), ...progress },
    { startedAt: run.startedAt },
  );

  const allDone = completedCount >= totalCases;
  // A case ended: a run with a concurrency limit starts its next waiting case.
  if (!allDone) await refillQueuedCases(deps, runId, run.config);
  return { allDone, completedCount };
}

export async function evaluateCase(
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

  // The run exists, so its case has a row to report on: a missing dataset or
  // test case is a grading problem, recorded as such instead of leaving the
  // case `running` forever.
  const dataset = await deps.datasetModel.findById(run.datasetId);
  if (!dataset) {
    await writeTopicJudgeError(
      deps,
      runTopic,
      runTopic.evalResult,
      GRADING_CONTEXT_MISSING.dataset,
    );
    return;
  }

  const benchmark = dataset.benchmarkId
    ? await deps.benchmarkModel.findById(dataset.benchmarkId)
    : null;

  const passThreshold = (run.config?.passThreshold as number) ?? 0.6;
  const benchmarkRubrics = benchmark?.rubrics ?? [];

  // Get messages for this topic
  const messages = await deps.messageModel.query({ topicId: runTopic.topicId });
  const assistantMessages = messages.filter((m: { role: string }) => m.role === 'assistant');
  const lastAssistantMsg = assistantMessages.at(-1);

  const existingResult = { ...runTopic.evalResult };

  if (!lastAssistantMsg || !lastAssistantMsg.content) {
    // No final answer: the step cap, or a turn the provider finished with no
    // text, is the model's failure; anything else stays an error (see classifyEmptyAnswer).
    const { error, status } = classifyEmptyAnswer({
      completionReason: existingResult?.completionReason as string | undefined,
      lastAssistantMessage: lastAssistantMsg,
      stepCap: run.config?.maxSteps as number | undefined,
      steps: existingResult?.steps as number | undefined,
    });
    await writeCompletion(deps, runTopic, {
      evalResult: { ...existingResult, error, rubricScores: [] },
      passed: false,
      score: 0,
      status,
    });
    return;
  }

  const testCase = runTopic.testCase;
  if (!testCase) {
    await writeTopicJudgeError(deps, runTopic, existingResult, GRADING_CONTEXT_MISSING.testCase);
    return;
  }

  // Resolve rubrics: TestCase evalMode > Dataset evalMode > Benchmark rubrics
  const evalMode = (testCase.evalMode ?? dataset.evalMode) as RubricType | null | undefined;
  const evalConfig = testCase.evalConfig ?? dataset.evalConfig;

  // ── External eval mode: agent finished, hand off to external scorer ──
  if (evalMode === 'external') {
    await writeCompletion(deps, runTopic, {
      evalResult: { ...existingResult, awaitingExternalEval: true },
      status: 'external',
    });
    return;
  }

  let effectiveRubrics: EvalBenchmarkRubric[];
  if (evalMode) {
    effectiveRubrics = [buildEvalModeRubric(evalMode, evalConfig)];
  } else {
    effectiveRubrics = benchmarkRubrics ?? [];
  }

  // No rubrics is the judge's call, not a reason to leave the case running:
  // `evaluate` grades against `expected` with its default rubric, and reports
  // a judge error when there is nothing to grade against.

  // Run evaluation. A judge that fails (throws, or reports `judgeError`) is
  // recorded as `judge_error` with its diagnostics; nothing of the attempt is
  // lost and a re-judge grades the same trajectory again.
  let result: EvaluateResult;
  try {
    const judge = await resolveEvalJudge(deps, {
      benchmarkMetadata: benchmark?.metadata,
      evalConfigs: [testCase.evalConfig, dataset.evalConfig],
      runConfig: run.config,
    });
    const topic = await deps.topicModel.findById(runTopic.topicId);
    const historyTail = topic?.metadata?.[EVAL_HISTORY_TAIL_METADATA_KEY];
    const historyTailMessageId = typeof historyTail === 'string' ? historyTail : undefined;
    const evidence = buildJudgeEvidence({
      historyTailMessageId,
      memorySnapshot: runTopic.evalResult?.memorySnapshot,
      messages: await withSubAgentMessages(deps, { messages, topicId: runTopic.topicId }),
    });
    const matchContext = createJudgeMatchContext(deps, judge, evidence);
    existingResult.judges = matchContext.judgeRequests;
    const actual = attemptReply({ historyTailMessageId, messages }) || lastAssistantMsg.content;
    result = await evaluate(
      { actual, rubrics: effectiveRubrics, testCase: testCase.content },
      { matchContext, passThreshold },
    );
  } catch (error) {
    await writeTopicJudgeError(deps, runTopic, existingResult, judgeFailureMessage(error));
    return;
  }
  const judgeError = readJudgeError(result);
  if (judgeError) {
    await writeTopicJudgeError(deps, runTopic, existingResult, judgeError, result);
    return;
  }

  const evalResult: EvalRunTopicResult = {
    ...existingResult,
    // A verdict replaces any earlier judge failure of this attempt.
    errorPhase: undefined,
    judgeError: undefined,
    rubricScores: result.rubricResults.map((r) => ({
      reason: r.reason,
      rubricId: r.rubricId,
      score: r.score,
      ...(r.verdicts && { verdicts: r.verdicts }),
    })),
  };

  // Write results to RunTopic
  await writeCompletion(deps, runTopic, {
    evalResult,
    passed: result.passed,
    score: result.score,
    status: result.passed ? 'passed' : 'failed',
  });
}

/**
 * Record that grading this attempt failed. The attempt's own output,
 * telemetry and Memory snapshot stay in `evalResult`; score and pass flag are
 * cleared because there is no verdict to report.
 */
async function writeTopicJudgeError(
  deps: EvalRunDeps,
  runTopic: { runId: string; topicId: string },
  existingResult: EvalRunTopicResult | null | undefined,
  judgeError: string,
  result?: EvaluateResult,
) {
  await writeCompletion(deps, runTopic, {
    evalResult: {
      ...existingResult,
      errorPhase: 'judge',
      judgeError,
      rubricScores: judgeDiagnostics(result),
    },
    passed: null,
    score: null,
    status: JUDGE_ERROR_STATUS,
  });
}

const writeCompletion = (
  deps: EvalRunDeps,
  topic: {
    runId: string;
    topicId: string;
    status?: string | null;
    evalResult?: EvalRunTopicResult | null;
  },
  value: Parameters<EvalRunDeps['runTopicModel']['updateByRunAndTopic']>[2],
) =>
  deps.runTopicModel.updateByRunAndTopic(topic.runId, topic.topicId, value, {
    executionId: topic.evalResult?.executionId,
    status: topic.status ?? undefined,
  });
