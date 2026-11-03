import type { RubricConfig } from '@lobechat/types';

import { normalize } from '../normalize';
import type { MatchResult } from './types';

export const matchLevenshtein = (
  actual: string,
  expected: string | undefined,
  config: RubricConfig,
): MatchResult => {
  const cfg = config as { threshold?: number };
  const threshold = cfg.threshold ?? 0.8;
  const a = normalize(actual);
  const e = normalize(expected ?? '');
  const dist = levenshteinDistance(a, e);
  const maxLen = Math.max(a.length, e.length);
  const similarity = maxLen === 0 ? 1 : 1 - dist / maxLen;
  const passed = similarity >= threshold;
  return { passed, reason: `similarity=${similarity.toFixed(3)}`, score: similarity };
};

function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array.from({ length: n + 1 }, () => 0),
  );

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }

  return dp[m][n];
}
