import { describe, expect, it } from 'vitest';

import { splitGraphemes, textNeedsCursiveJoining } from './cursiveScript';

describe('textNeedsCursiveJoining', () => {
  it('detects Persian / Arabic script', () => {
    expect(textNeedsCursiveJoining('بذار واضح صحبت کنم')).toBe(true);
    expect(textNeedsCursiveJoining('مرحبا')).toBe(true);
  });

  it('ignores Latin and CJK', () => {
    expect(textNeedsCursiveJoining('Let me speak clearly')).toBe(false);
    expect(textNeedsCursiveJoining('让我说清楚')).toBe(false);
  });
});

describe('splitGraphemes', () => {
  it('splits Persian into graphemes without altering characters', () => {
    const text = 'کنم';
    expect(splitGraphemes(text).join('')).toBe(text);
    expect(splitGraphemes(text).length).toBe(3);
  });
});
