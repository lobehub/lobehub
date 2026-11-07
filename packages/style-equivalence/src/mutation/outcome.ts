export type MutantOutcome = 'caught' | 'equivalent' | 'error' | 'missed';

export const mutantOutcome = ({
  detected,
  errors,
  expected,
  gaps,
}: {
  detected: Set<string>;
  errors: string[];
  expected: Set<string>;
  gaps: string[];
}): MutantOutcome => {
  if (errors.length) return 'error';
  if (!expected.size) return gaps.length ? 'caught' : 'equivalent';
  return expected.size === detected.size && [...expected].every((item) => detected.has(item))
    ? 'caught'
    : 'missed';
};
