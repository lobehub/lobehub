import type { EvalRunConfig, EvalRunMetrics, EvalRunTopicResult } from '@lobechat/types';

const roundCost = (v: number): number => Math.round(v * 1e6) / 1e6;

/** Binomial coefficient C(n, r); 0 when r is out of range. */
const choose = (n: number, r: number): number => {
  if (r < 0 || r > n) return 0;
  let result = 1;
  for (let i = 1; i <= r; i++) result = (result * (n - r + i)) / i;
  return result;
};
export async function evaluateAndFinalizeRun(params: {
  /**
   * Dataset case count. For external runs (Topics created on demand) this is
   * the denominator for totalCases/passRate; internal runs omit it and keep
   * `runTopics.length` (all cases are pre-created).
   */
  expectedTotalCases?: number;
  run: {
    config?: EvalRunConfig | null;
    id: string;
    metrics?: EvalRunMetrics | null;
    /**
     * Accepts a string because the finalize-run workflow reads this row inside a step, and
     * Upstash restores step results from JSON — the `Date` arrives as an ISO string.
     */
    startedAt?: Date | null | string;
  };
  runTopics: Array<{
    evalResult?: EvalRunTopicResult | null;
    passed?: boolean | null;
    runId: string;
    score?: number | null;
    status?: string | null;
    topicId: string;
  }>;
}): Promise<EvalRunMetrics> {
  const { run, runTopics } = params;
  const k = run.config?.k ?? 1;

  let passedCases = 0;
  let failedCases = 0;
  let errorCases = 0;
  let externalCases = 0;
  let timeoutCases = 0;
  // Attempts that ran but the judge could not grade: neither failed nor
  // scored. The run's grading is incomplete while any remain.
  let judgeErrorCases = 0;
  let totalScore = 0;
  // Sum of per-case averages (for per-case display)
  let sumCost = 0;
  let sumTokens = 0;
  let sumSteps = 0;
  let sumLlmCalls = 0;
  let sumToolCalls = 0;
  // Actual cumulative totals across all K executions
  let actualTotalCost = 0;
  let actualTotalTokens = 0;
  let actualTotalDuration = 0;
  const rubricScoreAcc: Record<string, { count: number; sum: number }> = {};

  // pass@k / pass^k counters (only meaningful when k > 1)
  let passAtKCount = 0;
  let passAllKCount = 0;
  // pass^j / pass@j for every j ≤ k, estimated without bias from each case's
  // passed attempts (τ-bench's pass^k, the Codex paper's pass@k), so runs of
  // different attempt counts compare on the same j.
  const passAllAtSum = Array.from({ length: k + 1 }, () => 0);
  const passAnyAtSum = Array.from({ length: k + 1 }, () => 0);

  for (const runTopic of runTopics) {
    const existingResult = runTopic.evalResult;

    // Accumulate per-case averages (cost/tokens/steps/llmCalls/toolCalls are averages per execution)
    if (existingResult?.cost) sumCost += existingResult.cost;
    if (existingResult?.tokens) sumTokens += existingResult.tokens;
    if (existingResult?.steps) sumSteps += existingResult.steps;
    if (existingResult?.llmCalls) sumLlmCalls += existingResult.llmCalls;
    if (existingResult?.toolCalls) sumToolCalls += existingResult.toolCalls;

    // Accumulate actual totals (totalCost has K-thread cumulative, fallback to cost for K=1)
    actualTotalCost += existingResult?.totalCost ?? existingResult?.cost ?? 0;
    actualTotalTokens += existingResult?.totalTokens ?? existingResult?.tokens ?? 0;
    actualTotalDuration += existingResult?.totalDuration ?? existingResult?.duration ?? 0;

    // Older stored rows may say "passed" despite an errored attempt. Rebuild
    // eligibility from the evidence, never trust that historical summary alone.
    const threads = existingResult?.threads;
    let status = runTopic.status;
    if (
      threads?.some((t) => t.status === 'error' || t.error === 'No assistant output') ||
      existingResult?.error === 'No assistant output'
    )
      status = 'error';
    else if (threads?.some((t) => t.status === 'timeout')) status = 'timeout';
    else if (
      existingResult?.errorPhase === 'judge' ||
      threads?.some((t) => t.status === 'judge_error' || t.errorPhase === 'judge')
    )
      status = 'judge_error';
    else if (threads?.some((t) => t.status === 'external')) status = 'external';
    else if (
      (status === 'passed' || status === 'failed') &&
      (typeof runTopic.passed !== 'boolean' ||
        (k > 1 && (!threads || threads.length !== k)) ||
        threads?.some(
          (t) =>
            typeof t.passed !== 'boolean' ||
            (t.status && !['passed', 'failed', 'completed'].includes(t.status)),
        ))
    )
      status = 'error';

    // Count by effective status. Invalid attempts are never model failures.
    if (status === 'passed') {
      passedCases++;
    } else if (status === 'failed') {
      failedCases++;
    } else if (status === 'error') {
      errorCases++;
    } else if (status === 'external') {
      externalCases++;
    } else if (status === 'timeout') {
      timeoutCases++;
    } else if (status === 'judge_error') {
      judgeErrorCases++;
    }

    // Only accumulate scores for judged (passed/failed) cases
    const judged = status === 'passed' || status === 'failed';
    if (judged && runTopic.score != null) {
      totalScore += runTopic.score;
    }

    // Accumulate per-rubric scores from judged cases only
    if (judged && existingResult?.rubricScores) {
      for (const rs of existingResult.rubricScores) {
        if (!rubricScoreAcc[rs.rubricId]) {
          rubricScoreAcc[rs.rubricId] = { count: 0, sum: 0 };
        }
        rubricScoreAcc[rs.rubricId].sum += rs.score;
        rubricScoreAcc[rs.rubricId].count++;
      }
    }

    // Only complete judged samples contribute to quality estimates.
    if (judged) {
      const threads = existingResult?.threads;
      const n = threads && threads.length > 0 ? threads.length : 1;
      const c =
        threads && threads.length > 0
          ? threads.filter((t) => t.passed === true).length
          : status === 'passed'
            ? 1
            : 0;
      for (let j = 1; j <= Math.min(k, n); j++) {
        passAllAtSum[j] += choose(c, j) / choose(n, j);
        passAnyAtSum[j] += 1 - choose(n - c, j) / choose(n, j);
      }
    }

    // pass@k / pass^k: derive from thread results when k > 1. A case with an
    // unjudged thread has unknown pass@k and pass^k, so it counts for neither.
    if (k > 1 && judged && existingResult?.threads && existingResult.threads.length > 0) {
      const anyThreadPassed = existingResult.threads.some((t) => t.passed === true);
      const allThreadsPassed = existingResult.threads.every((t) => t.passed === true);
      if (anyThreadPassed) passAtKCount++;
      if (allThreadsPassed) passAllKCount++;
    }
  }

  const totalCases = params.expectedTotalCases ?? runTopics.length;
  const evaluatedCases = passedCases + failedCases;
  const rubricScores: Record<string, number> = {};
  for (const [rubricId, acc] of Object.entries(rubricScoreAcc)) {
    rubricScores[rubricId] = acc.count > 0 ? acc.sum / acc.count : 0;
  }

  // Wall-clock duration: from startedAt (DB column, set when run enters 'running') to now
  const startedAt = run.startedAt ? new Date(run.startedAt).getTime() : undefined;
  const wallClockDuration = startedAt ? Date.now() - startedAt : undefined;

  const metrics: EvalRunMetrics = {
    averageScore: evaluatedCases > 0 ? totalScore / evaluatedCases : 0,
    // Cases with a RunTopic (executed). Equals totalCases for internal runs,
    // where every case gets a pre-created topic.
    completedCases: runTopics.length,
    cost: sumCost ? roundCost(sumCost) : undefined,
    duration: wallClockDuration || undefined,
    errorCases,
    externalCases: externalCases || undefined,
    failedCases,
    judgeErrorCases: judgeErrorCases || undefined,
    llmCalls: sumLlmCalls || undefined,
    passRate: totalCases > 0 ? passedCases / totalCases : 0,
    passedCases,
    perCaseCost: sumCost && totalCases ? roundCost(sumCost / totalCases) : undefined,
    perCaseLlmCalls:
      sumLlmCalls && totalCases ? Math.round((sumLlmCalls / totalCases) * 10) / 10 : undefined,
    perCaseSteps:
      sumSteps && totalCases ? Math.round((sumSteps / totalCases) * 10) / 10 : undefined,
    perCaseTokens: sumTokens && totalCases ? Math.round(sumTokens / totalCases) : undefined,
    perCaseToolCalls:
      sumToolCalls && totalCases ? Math.round((sumToolCalls / totalCases) * 10) / 10 : undefined,
    rubricScores,
    steps: sumSteps || undefined,
    timeoutCases,
    tokens: sumTokens || undefined,
    toolCalls: sumToolCalls || undefined,
    totalCases,
    totalCost: actualTotalCost ? roundCost(actualTotalCost) : undefined,
    totalDuration: actualTotalDuration || undefined,
    totalTokens: actualTotalTokens || undefined,
  };

  const complete = totalCases > 0 && evaluatedCases === totalCases;
  if (complete) {
    metrics.passAllAt = Object.fromEntries(
      passAllAtSum.slice(1).map((sum, index) => [String(index + 1), sum / totalCases]),
    );
    metrics.passAnyAt = Object.fromEntries(
      passAnyAtSum.slice(1).map((sum, index) => [String(index + 1), sum / totalCases]),
    );
  }

  // Add pass@k / pass^k only when k > 1
  if (k > 1 && complete) {
    metrics.passAtK = totalCases > 0 ? passAtKCount / totalCases : 0;
    metrics.passAllK = totalCases > 0 ? passAllKCount / totalCases : 0;
  }

  return metrics;
}
