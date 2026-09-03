import { describe, expect, it } from 'vitest';

import { shouldSubmitOnEnter } from './composerEnterGuard';

describe('shouldSubmitOnEnter', () => {
  it('submits on a plain Enter', () => {
    expect(shouldSubmitOnEnter({ shiftKey: false }, false)).toBe(true);
  });

  it('inserts a newline on Shift+Enter', () => {
    expect(shouldSubmitOnEnter({ shiftKey: true }, false)).toBe(false);
  });

  it('never submits the partial text of an in-flight IME composition', () => {
    expect(shouldSubmitOnEnter({ shiftKey: false }, true)).toBe(false);
    expect(shouldSubmitOnEnter({ shiftKey: true }, true)).toBe(false);
  });
});
