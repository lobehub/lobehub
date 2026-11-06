import type { MatchResult } from './types';

/** A missing verdict is a grading failure, not evidence that the candidate failed. */
export const judgeErrorResult = (reason: string): MatchResult => ({
  judgeError: reason,
  passed: false,
  reason,
  score: 0,
});
