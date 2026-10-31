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

  it('downgrades to the soft warning once the page is shortened under the refused limit', () => {
    expect(resolveCharLimitNotice({ length: 95, refusal: { limit: 100 } })?.kind).toBe('near');
    expect(resolveCharLimitNotice({ length: 50, refusal: { limit: 100 } })).toBeUndefined();
  });
});
