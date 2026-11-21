import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createAuthorizationUrl,
  createPkcePair,
  DEFAULT_OAUTH_SCOPE,
  exchangeAuthorizationCode,
  LOBEHUB_API_RESOURCE,
  LobeHubOAuthError,
  parseAuthorizationCallback,
  refreshAccessToken,
} from './auth';

const tokenFetch = (status: number, body: unknown) => {
  const requests: Request[] = [];
  const fetch = (async (input: string, init?: RequestInit) => {
    requests.push(new Request(input, init));
    return new Response(JSON.stringify(body), {
      headers: { 'Content-Type': 'application/json' },
      status,
    });
  }) as typeof globalThis.fetch;
  return { fetch, requests };
};

afterEach(() => {
  vi.useRealTimers();
});

describe('createAuthorizationUrl', () => {
  it('builds a PKCE authorize request for the API resource', () => {
    const url = new URL(
      createAuthorizationUrl({
        clientId: 'toby',
        codeChallenge: 'challenge',
        redirectUri: 'https://app.lobehub.com/oidc/callback/toby',
        state: 'st',
      }),
    );

    expect(`${url.origin}${url.pathname}`).toBe('https://app.lobehub.com/oidc/auth');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'toby',
      code_challenge: 'challenge',
      code_challenge_method: 'S256',
      prompt: 'consent',
      redirect_uri: 'https://app.lobehub.com/oidc/callback/toby',
      resource: LOBEHUB_API_RESOURCE,
      response_type: 'code',
      scope: DEFAULT_OAUTH_SCOPE,
      state: 'st',
    });
  });

  it('honors a custom baseURL with a trailing slash', () => {
    const url = createAuthorizationUrl({
      baseURL: 'http://localhost:3010/',
      clientId: 'c',
      codeChallenge: 'x',
      redirectUri: 'r',
      state: 's',
    });

    expect(url.startsWith('http://localhost:3010/oidc/auth?')).toBe(true);
  });
});

describe('parseAuthorizationCallback', () => {
  it('returns the code when the state matches', () => {
    expect(parseAuthorizationCallback('https://x/cb?code=abc%2F1&state=st', 'st')).toBe('abc/1');
  });

  it('rejects a mismatched state', () => {
    expect(() => parseAuthorizationCallback('https://x/cb?code=abc&state=other', 'st')).toThrow(
      expect.objectContaining({ code: 'state_mismatch' }),
    );
  });

  it('surfaces the provider error', () => {
    expect(() =>
      parseAuthorizationCallback(
        'https://x/cb?error=access_denied&error_description=No+thanks',
        'st',
      ),
    ).toThrow(expect.objectContaining({ code: 'access_denied', message: 'No thanks' }));
  });

  it('rejects a callback without a code', () => {
    expect(() => parseAuthorizationCallback('https://x/cb?state=st', 'st')).toThrow(
      expect.objectContaining({ code: 'missing_code' }),
    );
  });
});

describe('token requests', () => {
  it('exchanges the code with the verifier as a public client', async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const { fetch, requests } = tokenFetch(200, {
      access_token: 'at',
      expires_in: 3600,
      refresh_token: 'rt',
      scope: 'profile offline_access',
      token_type: 'Bearer',
    });

    const tokens = await exchangeAuthorizationCode({
      clientId: 'toby',
      code: 'abc',
      codeVerifier: 'ver',
      fetch,
      redirectUri: 'https://app.lobehub.com/oidc/callback/toby',
    });

    expect(requests[0].url).toBe('https://app.lobehub.com/oidc/token');
    expect(requests[0].headers.get('content-type')).toBe('application/x-www-form-urlencoded');
    expect(Object.fromEntries(new URLSearchParams(await requests[0].text()))).toEqual({
      client_id: 'toby',
      code: 'abc',
      code_verifier: 'ver',
      grant_type: 'authorization_code',
      redirect_uri: 'https://app.lobehub.com/oidc/callback/toby',
    });
    expect(tokens).toEqual({
      accessToken: 'at',
      expiresAt: 1_000_000 + 3_600_000,
      refreshToken: 'rt',
      scope: 'profile offline_access',
      tokenType: 'Bearer',
    });
  });

  it('refreshes with the refresh_token grant', async () => {
    const { fetch, requests } = tokenFetch(200, {
      access_token: 'at2',
      expires_in: 60,
      refresh_token: 'rt2',
    });

    const tokens = await refreshAccessToken({ clientId: 'toby', fetch, refreshToken: 'rt' });

    expect(Object.fromEntries(new URLSearchParams(await requests[0].text()))).toEqual({
      client_id: 'toby',
      grant_type: 'refresh_token',
      refresh_token: 'rt',
    });
    expect(tokens.accessToken).toBe('at2');
    expect(tokens.refreshToken).toBe('rt2');
    expect(tokens.tokenType).toBe('Bearer');
  });

  it('maps an OAuth error response to LobeHubOAuthError', async () => {
    const { fetch } = tokenFetch(400, {
      error: 'invalid_grant',
      error_description: 'grant request is invalid',
    });

    const failure = refreshAccessToken({ clientId: 'toby', fetch, refreshToken: 'gone' });

    await expect(failure).rejects.toBeInstanceOf(LobeHubOAuthError);
    await expect(failure).rejects.toMatchObject({
      code: 'invalid_grant',
      message: 'grant request is invalid',
      status: 400,
    });
  });

  it('rejects a success response without an access token', async () => {
    const { fetch } = tokenFetch(200, { token_type: 'Bearer' });

    await expect(
      refreshAccessToken({ clientId: 'toby', fetch, refreshToken: 'rt' }),
    ).rejects.toMatchObject({
      code: 'missing_access_token',
    });
  });
});

describe('createPkcePair', () => {
  it('derives the S256 challenge from the verifier', async () => {
    const { challenge, verifier } = await createPkcePair();

    expect(verifier).toMatch(/^[\w-]{43}$/);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    const expected = btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replace(/=+$/, '');
    expect(challenge).toBe(expected);
  });
});
