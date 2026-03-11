import type { RubricConfig } from '@lobechat/types';

import type { MatchResult } from './types';

export const matchNumeric = (
  actual: string,
  expected: string | undefined,
  config: RubricConfig,
): MatchResult => {
  const cfg = config as { tolerance?: number; value: number };
  const actualNum = Number.parseFloat(actual.replaceAll(/[^.\-\d]/g, ''));
  if (Number.isNaN(actualNum)) {
    return { passed: false, reason: `Could not parse number from "${actual}"`, score: 0 };
  }
  const tolerance = cfg.tolerance ?? 0.01;
  const expectedNum = expected !== undefined ? Number.parseFloat(expected) : cfg.value;
  const passed = Math.abs(actualNum - expectedNum) <= tolerance;
  return { passed, score: passed ? 1 : 0 };
};
