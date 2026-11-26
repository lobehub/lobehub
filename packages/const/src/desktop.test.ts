import { describe, expect, it } from 'vitest';

import { isDesktopOidcClient } from './desktop';

describe('isDesktopOidcClient', () => {
  it('recognises both LobeHub Desktop and Lobot', () => {
    expect(isDesktopOidcClient('lobehub-desktop')).toBe(true);
    expect(isDesktopOidcClient('lobot-desktop')).toBe(true);
  });

  it('rejects other clients and missing ids', () => {
    expect(isDesktopOidcClient('lobehub-mobile')).toBe(false);
    expect(isDesktopOidcClient('lobehub-cli')).toBe(false);
    expect(isDesktopOidcClient(undefined)).toBe(false);
    expect(isDesktopOidcClient('')).toBe(false);
  });
});
