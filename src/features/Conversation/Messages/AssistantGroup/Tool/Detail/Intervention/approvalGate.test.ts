import { describe, expect, it } from 'vitest';

import { isChoiceSubmitBlocked } from './approvalGate';

describe('isChoiceSubmitBlocked', () => {
  it('holds both approve choices while the intervention blocks approval', () => {
    expect(isChoiceSubmitBlocked('approve', true)).toBe(true);
    expect(isChoiceSubmitBlocked('approve-remember', true)).toBe(true);
  });

  it('always lets the user reject', () => {
    expect(isChoiceSubmitBlocked('reject', true)).toBe(false);
  });

  it('lets every choice through when nothing blocks approval', () => {
    expect(isChoiceSubmitBlocked('approve', false)).toBe(false);
    expect(isChoiceSubmitBlocked('approve-remember')).toBe(false);
    expect(isChoiceSubmitBlocked('reject')).toBe(false);
  });
});
