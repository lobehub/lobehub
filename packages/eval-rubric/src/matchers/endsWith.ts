import { normalize } from '../normalize';
import type { MatchResult } from './types';

export const matchEndsWith = (actual: string, expected: string | undefined): MatchResult => {
  const a = normalize(actual);
  const e = normalize(expected ?? '');
  const passed = a.endsWith(e);
  return { passed, score: passed ? 1 : 0 };
};
