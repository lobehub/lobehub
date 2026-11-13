import type {
  AnswerExtractor,
  EvalBenchmarkRubric,
  EvalRuleVerdict,
  EvalTestCaseContent,
} from '@lobechat/types';

import { extract } from './extractors';
import { match, type MatchContext, type MatchResult } from './matchers';

export interface EvaluateResult {
  /** Any grading failure makes this evaluation incomplete; do not use its score as a verdict. */
  judgeError?: string;
  passed: boolean;
  reason?: string;
  rubricResults: RubricResult[];
  score: number;
}

export interface RubricResult {
  judgeError?: string;
  passed: boolean;
  reason?: string;
  rubricId: string;
  score: number;
  verdicts?: EvalRuleVerdict[];
}

export interface EvaluateOptions {
  /**
   * Default extractor applied before matching (benchmark-level)
   */
  extractor?: AnswerExtractor;
  /**
   * Context for LLM-based rubrics, passed through to match()
   */
  matchContext?: MatchContext;
  /**
   * Pass threshold for overall score
   * @default 0.6
   */
  passThreshold?: number;
}

/**
 * Evaluate agent output against a test case using one or more rubrics.
 *
 * Flow:
 * 1. For each rubric, optionally extract answer from output
 * 2. If expected is a JSON array string, try any-of matching
 * 3. Run the rubric matcher
 * 4. Compute weighted score
 */
export const evaluate = async (
  params: { actual: string; rubrics: EvalBenchmarkRubric[]; testCase: EvalTestCaseContent },
  options: EvaluateOptions = {},
): Promise<EvaluateResult> => {
  const { actual: actualOutput, rubrics: inputRubrics, testCase } = params;
  const { passThreshold = 0.6, matchContext } = options;

  let rubrics = inputRubrics;

  if (!rubrics || rubrics.length === 0) {
    if (testCase.expected) {
      rubrics = [
        {
          config: {} as any,
          id: 'default-contains',
          name: 'Default Contains',
          type: 'contains',
          weight: 1,
        },
      ];
    } else {
      return {
        judgeError: 'No rubrics configured',
        passed: false,
        reason: 'No rubrics configured',
        rubricResults: [],
        score: 0,
      };
    }
  }

  const rubricResults: RubricResult[] = [];
  let totalWeight = 0;
  let weightedScore = 0;
  // A gating rubric (rule checklist) fails the case on its own: the threshold
  // only applies to scored rubrics.
  let gateFailed = false;

  for (const rubric of rubrics) {
    // Step 1: Extract answer if extractor is configured
    const extractor = rubric.extractor ?? options.extractor;
    const extracted = extractor ? extract(actualOutput, extractor) : actualOutput;

    // Step 2: Resolve expected value
    const expected = testCase.expected;

    // Step 3: Handle multi-candidate (JSON array string in expected)
    let result: MatchResult;

    if (rubric.type !== 'any-of' && expected && isJsonArray(expected)) {
      // Auto any-of: try each candidate
      const candidates: string[] = JSON.parse(expected);
      const results: MatchResult[] = [];
      for (const c of candidates) {
        results.push(
          await match(
            { input: testCase.input, actual: extracted, expected: c, rubric },
            matchContext,
          ),
        );
      }
      const best = results.reduce((a, b) => (a.score >= b.score ? a : b));
      // A successful alternative cannot hide a Judge outage on another candidate.
      const judgeError = results
        .flatMap((item) => (item.judgeError ? [item.judgeError] : []))
        .join('\n');
      result = judgeError ? { ...best, judgeError, passed: false } : best;
    } else {
      result = await match(
        { input: testCase.input, actual: extracted, expected, rubric },
        matchContext,
      );
    }

    rubricResults.push({
      ...(result.judgeError && { judgeError: result.judgeError }),
      passed: result.passed,
      reason: result.reason,
      rubricId: rubric.id,
      score: result.score,
      ...(result.verdicts && { verdicts: result.verdicts }),
    });
    if (result.gating && !result.passed) gateFailed = true;

    totalWeight += rubric.weight;
    weightedScore += result.score * rubric.weight;
  }

  const score = totalWeight > 0 ? weightedScore / totalWeight : 0;
  const judgeError = rubricResults
    .flatMap((result) => (result.judgeError ? [`${result.rubricId}: ${result.judgeError}`] : []))
    .join('\n');
  const passed = !judgeError && score >= passThreshold && !gateFailed;

  return {
    ...(judgeError && { judgeError }),
    passed,
    rubricResults,
    score,
  };
};

function isJsonArray(s: string): boolean {
  if (!s.startsWith('[')) return false;
  try {
    const parsed = JSON.parse(s);
    return Array.isArray(parsed);
  } catch {
    return false;
  }
}
