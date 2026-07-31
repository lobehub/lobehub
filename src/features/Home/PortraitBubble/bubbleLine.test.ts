import { describe, expect, it } from 'vitest';

import { resolveBubbleLine } from './bubbleLine';

describe('resolveBubbleLine', () => {
  it('lets a promo interrupt the brief', () => {
    expect(resolveBubbleLine({ hasBrief: true, hasPromo: true })).toBe('promo');
  });

  it('hands the brief back once the promo is gone', () => {
    expect(resolveBubbleLine({ hasBrief: true, hasPromo: false })).toBe('brief');
  });

  it('falls back to the static line rather than going mute', () => {
    expect(resolveBubbleLine({ hasBrief: false, hasPromo: false })).toBe('fallback');
    expect(resolveBubbleLine({ hasBrief: false, hasPromo: true })).toBe('promo');
  });
});
