import { describe, expect, it } from 'vitest';

import { shouldSubmitOnEnter } from './composerEnterGuard';

describe('shouldSubmitOnEnter', () => {
  it('submits on a plain Enter (no shift, not composing)', () => {
    expect(shouldSubmitOnEnter({ shiftKey: false }, false)).toBe(true);
  });

  it('does not submit on Shift+Enter (newline)', () => {
    expect(shouldSubmitOnEnter({ shiftKey: true }, false)).toBe(false);
  });

  it('does not submit while an IME composition is in progress — the Enter only confirms the candidate', () => {
    expect(shouldSubmitOnEnter({ shiftKey: false }, true)).toBe(false);
  });

  it('does not submit on Shift+Enter even mid-composition', () => {
    expect(shouldSubmitOnEnter({ shiftKey: true }, true)).toBe(false);
  });
});
