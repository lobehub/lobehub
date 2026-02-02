import { describe, expect, it } from 'vitest';

import { buildAuthorizeUrl } from './authorize';

describe('buildAuthorizeUrl', () => {
  it('builds URL with required params', () => {
    const url = buildAuthorizeUrl({
      authorizationEndpoint: 'https://auth.example.com/authorize',
      clientId: 'client-123',
      codeChallenge: 'challenge',
      redirectUri: 'https://app.example.com/callback',
      state: 'state-xyz',
    });
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe('https://auth.example.com/authorize');
    expect(parsed.searchParams.get('client_id')).toBe('client-123');
    expect(parsed.searchParams.get('code_challenge')).toBe('challenge');
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
    expect(parsed.searchParams.get('redirect_uri')).toBe('https://app.example.com/callback');
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('state')).toBe('state-xyz');
    expect(parsed.searchParams.has('scope')).toBe(false);
  });

  it('includes scope when provided', () => {
    const url = buildAuthorizeUrl({
      authorizationEndpoint: 'https://auth.example.com/authorize',
      clientId: 'client-123',
      codeChallenge: 'challenge',
      redirectUri: 'https://app.example.com/callback',
      scope: 'openid profile',
      state: 'state-xyz',
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.get('scope')).toBe('openid profile');
  });
});
