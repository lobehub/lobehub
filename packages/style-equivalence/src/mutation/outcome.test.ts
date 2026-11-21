import { describe, expect, it } from 'vitest';

import { mutantOutcome } from './outcome';

const outcome = (
  expected: string[],
  detected: string[],
  gaps: string[] = [],
  errors: string[] = [],
) => mutantOutcome({ detected: new Set(detected), errors, expected: new Set(expected), gaps });

describe('mutantOutcome', () => {
  it('counts a mutant that changes nothing sampled and opens no gap as equivalent', () => {
    expect(outcome([], [])).toBe('equivalent');
  });

  it('counts a mutant inside an unsampled state as caught by the gap it opens', () => {
    expect(outcome([], [], ['STATE_UNMODELED'])).toBe('caught');
  });

  it('requires the detected conditions to match the expected ones exactly', () => {
    expect(outcome(['light/1280/default#0'], ['light/1280/default#0'])).toBe('caught');
    expect(outcome(['light/1280/default#0'], [])).toBe('missed');
  });

  it('reports errors before anything else', () => {
    expect(outcome([], [], [], ['MUTANT_NOT_CAPTURED'])).toBe('error');
  });
});
