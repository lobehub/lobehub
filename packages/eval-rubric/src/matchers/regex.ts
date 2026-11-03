import type { RubricConfig } from '@lobechat/types';

import type { MatchResult } from './types';

export const matchRegex = (actual: string, config: RubricConfig): MatchResult => {
  const cfg = config as { pattern: string };
  const passed = new RegExp(cfg.pattern, 'i').test(actual);
  return { passed, score: passed ? 1 : 0 };
};
