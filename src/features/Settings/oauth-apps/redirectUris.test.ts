import { describe, expect, it } from 'vitest';

import { redirectUriListMessageKey, redirectUriMessageKey } from './redirectUris';

describe('redirectUriMessageKey', () => {
  it('accepts a valid URI and a blank row', () => {
    expect(redirectUriMessageKey('https://dc.lobehub.com/callback')).toBeUndefined();
    expect(redirectUriMessageKey('   ')).toBeUndefined();
    expect(redirectUriMessageKey(undefined)).toBeUndefined();
  });

  it('maps each rejected URI to its message', () => {
    expect(redirectUriMessageKey('https://*.lobehub.com/cb')).toBe(
      'oauthApp.validation.redirectUri.wildcard',
    );
    expect(redirectUriMessageKey('http://dc.lobehub.com/cb')).toBe(
      'oauthApp.validation.redirectUri.insecure',
    );
  });
});

describe('redirectUriListMessageKey', () => {
  it('refuses a list that is empty once blank rows are dropped', () => {
    expect(redirectUriListMessageKey([])).toBe('oauthApp.validation.redirectUriRequired');
    expect(redirectUriListMessageKey(['', '  ', undefined])).toBe(
      'oauthApp.validation.redirectUriRequired',
    );
  });

  it('refuses more URIs than the cap', () => {
    const uris = Array.from({ length: 6 }, (_, i) => `https://a${i}.com/cb`);
    expect(redirectUriListMessageKey(uris)).toBe('oauthApp.validation.redirectUriTooMany');
  });

  it('accepts a list with at least one URI', () => {
    expect(redirectUriListMessageKey(['https://a.com/cb', ''])).toBeUndefined();
  });
});
