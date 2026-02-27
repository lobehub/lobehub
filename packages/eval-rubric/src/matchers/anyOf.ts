import type { RubricConfig } from '@lobechat/types';

import { normalize } from '../normalize';
import type { MatchResult } from './types';

export const matchAnyOf = (actual: string, config: RubricConfig): MatchResult => {
  const cfg = config as { caseSensitive?: boolean; values: string[] };
  const candidates = cfg.values;
  const cs = cfg.caseSensitive ?? false;
  const a = normalize(actual, cs);
  const passed = candidates.some((c) => normalize(c, cs) === a);
  return { passed, score: passed ? 1 : 0 };
};
