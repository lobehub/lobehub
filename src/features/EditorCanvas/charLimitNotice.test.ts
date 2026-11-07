import { describe, expect, it } from 'vitest';

import { resolveCharLimitNotice } from './charLimitNotice';

describe('resolveCharLimitNotice', () => {
  it('shows nothing without a known limit', () => {
    expect(resolveCharLimitNotice({ length: 500 })).toBeUndefined();
  });

  it('is blocked while the page is over the refused limit', () => {
    expect(resolveCharLimitNotice({ length: 120, refusal: { limit: 100 } })).toEqual({
      kind: 'blocked',
      limit: 100,
    });
  });

  it('prefers the refused limit over the plan limit', () => {
    expect(
      resolveCharLimitNotice({ length: 120, planLimit: 1000, refusal: { limit: 100 } }),
    ).toEqual({ kind: 'blocked', limit: 100 });
  });

  it('warns softly from 90% of the plan limit', () => {
    expect(resolveCharLimitNotice({ length: 90, planLimit: 100 })).toEqual({
      kind: 'near',
      limit: 100,
    });
    expect(resolveCharLimitNotice({ length: 89, planLimit: 100 })).toBeUndefined();
  });

  it('is over, not near, when the page passes the plan limit before any save is refused', () => {
    expect(resolveCharLimitNotice({ length: 101, planLimit: 100 })).toEqual({
      kind: 'over',
      limit: 100,
    });
    // exactly at the limit is still allowed
    expect(resolveCharLimitNotice({ length: 100, planLimit: 100 })?.kind).toBe('near');
  });

  it('downgrades to the soft warning once the page is shortened under the refused limit', () => {
    expect(resolveCharLimitNotice({ length: 95, refusal: { limit: 100 } })?.kind).toBe('near');
    expect(resolveCharLimitNotice({ length: 50, refusal: { limit: 100 } })).toBeUndefined();
  });
});
