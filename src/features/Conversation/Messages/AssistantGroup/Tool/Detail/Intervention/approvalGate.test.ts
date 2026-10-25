import { describe, expect, it } from 'vitest';

import { getApprovalChoices, isChoiceSubmitBlocked, resolveRememberAction } from './approvalGate';

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

describe('getApprovalChoices', () => {
  it('offers approve-and-remember for the allow-list or a tool-offered choice', () => {
    expect(getApprovalChoices({ allowListMode: false, toolRemember: false })).toEqual([
      'approve',
      'reject',
    ]);
    expect(getApprovalChoices({ allowListMode: true, toolRemember: false })).toEqual([
      'approve',
      'approve-remember',
      'reject',
    ]);
    expect(getApprovalChoices({ allowListMode: false, toolRemember: true })).toEqual([
      'approve',
      'approve-remember',
      'reject',
    ]);
  });
});

describe('resolveRememberAction', () => {
  it("prefers the tool's own remember step over the allow-list", () => {
    expect(resolveRememberAction({ allowListMode: true, toolRemember: true })).toBe('tool');
    expect(resolveRememberAction({ allowListMode: false, toolRemember: true })).toBe('tool');
    expect(resolveRememberAction({ allowListMode: true, toolRemember: false })).toBe('allow-list');
    expect(resolveRememberAction({ allowListMode: false, toolRemember: false })).toBe('none');
  });
});
