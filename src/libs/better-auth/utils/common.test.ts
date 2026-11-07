import { describe, expect, it } from 'vitest';

import { canUnlinkProvider, getProviderDisplayName, isLinkOnlyProvider } from './common';

describe('isLinkOnlyProvider', () => {
  it('treats X as link-only and regular SSO providers as sign-in providers', () => {
    expect(isLinkOnlyProvider('twitter')).toBe(true);
    expect(isLinkOnlyProvider('google')).toBe(false);
  });
});

describe('getProviderDisplayName', () => {
  it('uses the current brand name for X and the id for others', () => {
    expect(getProviderDisplayName('twitter')).toBe('X');
    expect(getProviderDisplayName('github')).toBe('github');
  });
});

describe('canUnlinkProvider', () => {
  it('keeps the only sign-in provider when the other linked account is link-only', () => {
    expect(
      canUnlinkProvider({
        hasPasswordAccount: false,
        linkedProviders: ['google', 'twitter'],
        provider: 'google',
      }),
    ).toBe(false);
  });

  it('always allows unlinking a link-only provider', () => {
    expect(
      canUnlinkProvider({
        hasPasswordAccount: false,
        linkedProviders: ['google', 'twitter'],
        provider: 'twitter',
      }),
    ).toBe(true);
  });

  it('allows unlinking when another sign-in method remains', () => {
    expect(
      canUnlinkProvider({
        hasPasswordAccount: false,
        linkedProviders: ['google', 'github', 'twitter'],
        provider: 'google',
      }),
    ).toBe(true);
    expect(
      canUnlinkProvider({
        hasPasswordAccount: true,
        linkedProviders: ['google', 'twitter'],
        provider: 'google',
      }),
    ).toBe(true);
  });
});
