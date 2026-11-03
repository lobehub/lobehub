import { normalize } from '../normalize';
import type { MatchResult } from './types';

export const matchEquals = (actual: string, expected: string | undefined): MatchResult => {
  const a = normalize(actual);
  const e = normalize(expected ?? '');
  const passed = a === e;
  return { passed, score: passed ? 1 : 0 };
};
