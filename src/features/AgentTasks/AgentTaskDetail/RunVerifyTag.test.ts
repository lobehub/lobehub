import { describe, expect, it } from 'vitest';

import { resolveVerdict } from './RunVerifyTag';

describe('resolveVerdict', () => {
  it('maps a run to the verdict it actually reached', () => {
    expect(resolveVerdict('passed')).toBe('passed');
    expect(resolveVerdict('failed')).toBe('failed');
    expect(resolveVerdict('errored')).toBe('errored');
  });

  it('treats an in-flight verification as running', () => {
    expect(resolveVerdict('running')).toBe('running');
    expect(resolveVerdict('verifying')).toBe('running');
  });

  it('does not claim a verdict for a run that has not been checked yet', () => {
    // A planned session has a checklist but no result; saying "verifying"
    // there would claim work that has not started.
    expect(resolveVerdict('planned')).toBe('pending');
    expect(resolveVerdict(null)).toBe('pending');
  });
});
