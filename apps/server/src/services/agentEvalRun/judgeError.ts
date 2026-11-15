import type { EvaluateResult } from '@lobechat/eval-rubric';
import type { EvalRubricScore } from '@lobechat/types';

/**
 * A judge failure is not a verdict. When the judge model, its configuration
 * or its answer parsing fails, the attempt keeps everything it produced
 * (reply, tool calls, Memory snapshot, cost) and takes this status instead of
 * `failed`: no score, no pass flag, counted apart in the metrics, and the only
 * way out is a re-judge of the same trajectory. Retry and resume never touch
 * it, so a judge outage can never cause a candidate to run again.
 */
export const JUDGE_ERROR_STATUS = 'judge_error' as const;

/** Statuses whose attempt has a recorded trajectory the judge can grade again. */
export const REJUDGEABLE_STATUSES: ReadonlySet<string> = new Set([
  'passed',
  'failed',
  JUDGE_ERROR_STATUS,
]);

/**
 * The rubric package reports a judge failure as `judgeError` on the evaluate
 * result and on the rubric result it happened in; a real zero score has none.
 */
export const readJudgeError = (result: EvaluateResult): string | undefined => {
  if (result.judgeError) return result.judgeError;
  return result.rubricResults.find((rubric) => rubric.judgeError)?.judgeError;
};

/** Stored when the attempt exists but what it should be graded against does not. */
export const GRADING_CONTEXT_MISSING = {
  dataset: 'Grading context missing: dataset',
  run: 'Grading context missing: run',
  testCase: 'Grading context missing: test case',
} as const;

/** The message stored for a judge that threw instead of answering. */
export const judgeFailureMessage = (error: unknown) =>
  `Judge failed: ${error instanceof Error && error.message ? error.message : String(error)}`;

/**
 * What the judge did manage to say, kept for diagnosis. Scores of rubrics
 * that failed are not scores, so they are dropped; a rubric that graded
 * before another one failed keeps its reason.
 */
export const judgeDiagnostics = (result?: EvaluateResult): EvalRubricScore[] =>
  (result?.rubricResults ?? [])
    .filter((rubric) => !rubric.judgeError)
    .map((rubric) => ({
      reason: rubric.reason,
      rubricId: rubric.rubricId,
      score: rubric.score,
      ...(rubric.verdicts && { verdicts: rubric.verdicts }),
    }));
