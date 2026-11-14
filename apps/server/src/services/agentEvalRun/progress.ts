import type { EvalRunMetrics } from '@lobechat/types';

import { JUDGE_ERROR_STATUS } from './judgeError';
import { roundCost } from './utils';

interface ProgressTopic {
  evalResult?: unknown;
  status?: string | null;
}

/**
 * A run's live progress from its RunTopics as they are now: cases finished and
 * their verdicts, with the cost, tokens and steps they took. Written as cases
 * end, and when a run (re)starts, so cases kept from before count at once.
 */
/** Live progress: the counts always, the totals once a case has reported them. */
export type RunProgress = Partial<EvalRunMetrics> &
  Pick<EvalRunMetrics, 'failedCases' | 'passedCases'> & {
    completedCases: number;
    errorCases: number;
    timeoutCases: number;
  };

export const runProgressOf = (allTopics: ProgressTopic[]): RunProgress => {
  const finished = (t: ProgressTopic) => {
    const r = t.evalResult as Record<string, unknown> | null | undefined;
    return !!r && 'completionReason' in r;
  };
  const completedCount = allTopics.filter(
    (t) => finished(t) || t.status === 'timeout' || t.status === 'external',
  ).length;
  const passedCases = allTopics.filter((t) => t.status === 'passed').length;
  const failedCases = allTopics.filter((t) => t.status === 'failed').length;
  const errorCases = allTopics.filter((t) => t.status === 'error').length;
  const externalCasesTraj = allTopics.filter((t) => t.status === 'external').length;
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

  return {
    completedCases: completedCount,
    cost: sumCost ? roundCost(sumCost) : undefined,
    errorCases,
    externalCases: externalCasesTraj || undefined,
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
      sumSteps && completedCount ? Math.round((sumSteps / completedCount) * 10) / 10 : undefined,
    perCaseTokens: sumTokens && completedCount ? Math.round(sumTokens / completedCount) : undefined,
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
  };
};
