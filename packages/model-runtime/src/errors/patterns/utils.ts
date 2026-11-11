import type { ErrorPattern } from './types';

export const sub = (
  value: string,
  opts?: { caseInsensitive?: boolean },
): ErrorPattern['match'] => ({
  kind: 'substring',
  value,
  caseInsensitive: opts?.caseInsensitive,
});
