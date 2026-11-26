import { describe, expect, it } from 'vitest';

import { resolveEscapeKey, stepQuestion } from './hotkeys';

describe('resolveEscapeKey', () => {
  it('only leaves the text box when typing inside the card', () => {
    expect(resolveEscapeKey({ canSkip: true, hasDraft: false, typingInCard: true })).toBe('blur');
  });

  it('skips an untouched form', () => {
    expect(resolveEscapeKey({ canSkip: true, hasDraft: false, typingInCard: false })).toBe('skip');
  });

  it('never discards a draft', () => {
    expect(resolveEscapeKey({ canSkip: true, hasDraft: true, typingInCard: false })).toBe('ignore');
  });

  it('does nothing when the form offers no skip', () => {
    expect(resolveEscapeKey({ canSkip: false, hasDraft: false, typingInCard: false })).toBe(
      'ignore',
    );
  });
});

describe('stepQuestion', () => {
  it('moves to the next question and wraps around', () => {
    expect(stepQuestion(0, 1, 3)).toBe(1);
    expect(stepQuestion(2, 1, 3)).toBe(0);
    expect(stepQuestion(0, -1, 3)).toBe(2);
  });
});
