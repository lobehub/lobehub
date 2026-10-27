import type { AuthorizationServerMetadata } from '@modelcontextprotocol/client';
import { registerClient, RegistrationRejectedError } from '@modelcontextprotocol/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  discoverConnectorOAuth,
  exchangeConnectorCode,
  refreshConnectorToken,
  registerDynamicClient,
  registeredAuthMethod,
  selectRegistrationAuthMethod,
  toClientInformation,
} from './oauth';

vi.mock('@modelcontextprotocol/client', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  registerClient: vi.fn(),
}));
// These tests stub the global fetch; the SSRF boundary itself is covered by
// oauth.network.test.ts over real sockets.
vi.mock('@lobechat/ssrf-safe-fetch', () => ({
  ssrfSafeFetch: (url: string, init?: RequestInit) => fetch(url, init),
}));

const metadataWith = (
  token_endpoint_auth_methods_supported?: string[],
): AuthorizationServerMetadata =>
  ({
    authorization_endpoint: 'https://auth.example.com/oauth/authorize',
    issuer: 'https://auth.example.com',
    registration_endpoint: 'https://auth.example.com/oauth/register',
    response_types_supported: ['code'],
    token_endpoint: 'https://auth.example.com/oauth/token',
    token_endpoint_auth_methods_supported,
  }) as AuthorizationServerMetadata;

describe('selectRegistrationAuthMethod', () => {
  it('keeps the confidential default when the server does not advertise methods', () => {
    expect(selectRegistrationAuthMethod(metadataWith())).toBe('client_secret_post');
    expect(selectRegistrationAuthMethod(metadataWith([]))).toBe('client_secret_post');
  });

  it('registers a public client when the server only accepts "none"', () => {
    expect(selectRegistrationAuthMethod(metadataWith(['none']))).toBe('none');
  });

  it('prefers client_secret_post, then client_secret_basic, over "none"', () => {
    expect(
      selectRegistrationAuthMethod(
        metadataWith(['none', 'client_secret_basic', 'client_secret_post']),
      ),
    ).toBe('client_secret_post');
    expect(selectRegistrationAuthMethod(metadataWith(['none', 'client_secret_basic']))).toBe(
      'client_secret_basic',
    );
  });

  it('falls back to a public client when no supported method is usable', () => {
    expect(selectRegistrationAuthMethod(metadataWith(['private_key_jwt']))).toBe('none');
  });
});

describe('registerDynamicClient', () => {
  beforeEach(() => {
    vi.mocked(registerClient).mockReset();
    vi.mocked(registerClient).mockResolvedValue({ client_id: 'issued', redirect_uris: [] });
  });

  it('requests the auth method the authorization server supports', async () => {
    // Regression: a hardcoded client_secret_post registration was rejected by
    // public-client-only servers with `invalid_client_metadata`.
    await registerDynamicClient({
      authorizationServerUrl: 'https://auth.example.com',
      metadata: metadataWith(['none']),
      redirectUri: 'https://app.example.com/oauth/connector/callback',
    });

    expect(registerClient).toHaveBeenCalledWith(
      'https://auth.example.com',
      expect.objectContaining({
        clientMetadata: expect.objectContaining({
          redirect_uris: ['https://app.example.com/oauth/connector/callback'],
          token_endpoint_auth_method: 'none',
        }),
      }),
    );
  });
});

/**
 * Token endpoint that, like Linear's, only accepts the auth method the client
 * was registered with (`client_secret_post`). Records how each request
 * authenticated.
 */
const stubPostOnlyTokenEndpoint = (errorStatus = 401) => {
  const attempts: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const body = new URLSearchParams(String(init?.body ?? ''));
      const method = headers.get('authorization')?.startsWith('Basic ')
        ? 'client_secret_basic'
        : body.has('client_secret')
          ? 'client_secret_post'
          : 'none';
      attempts.push(method);
      if (method !== 'client_secret_post') {
        return Response.json(
          { error: 'invalid_client', error_description: 'Client authentication failed' },
          { status: errorStatus },
        );
      }
      return Response.json({ access_token: 'tok', refresh_token: 'rt', token_type: 'Bearer' });
    }),
  );
  return attempts;
};

const exchange = (oidc: Parameters<typeof toClientInformation>[0], methods?: string[]) =>
  exchangeConnectorCode({
    authorizationCode: 'code',
    authorizationServerUrl: 'https://auth.example.com',
    clientInformation: toClientInformation(oidc),
    codeVerifier: 'verifier',
    metadata: metadataWith(methods),
    redirectUri: 'https://app.example.com/oauth/connector/callback',
  });

describe('token endpoint client authentication', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the method recorded at registration instead of the SDK preference', async () => {
    // Regression: a DCR client registered as client_secret_post was sent with
    // HTTP Basic and rejected with `invalid_client: Client authentication failed`.
    const attempts = stubPostOnlyTokenEndpoint();

    const result = await exchange(
      { clientId: 'cid', clientSecret: 'secret', tokenEndpointAuthMethod: 'client_secret_post' },
      ['client_secret_basic', 'client_secret_post', 'none'],
    );

    expect(attempts).toEqual(['client_secret_post']);
    expect(result).toEqual({
      authMethod: undefined,
      tokens: expect.objectContaining({ access_token: 'tok' }),
    });
  });

  it('retries with the other secret method when none is recorded, and reports it', async () => {
    const attempts = stubPostOnlyTokenEndpoint();

    const result = await exchange({ clientId: 'cid', clientSecret: 'secret' }, [
      'client_secret_basic',
      'client_secret_post',
    ]);

    expect(attempts).toEqual(['client_secret_basic', 'client_secret_post']);
    expect(result.authMethod).toBe('client_secret_post');
  });

  it('does not retry when the recorded method is rejected', async () => {
    const attempts = stubPostOnlyTokenEndpoint();

    await expect(
      exchange(
        { clientId: 'cid', clientSecret: 'secret', tokenEndpointAuthMethod: 'client_secret_basic' },
        ['client_secret_basic', 'client_secret_post'],
      ),
    ).rejects.toThrow('Client authentication failed');
    expect(attempts).toEqual(['client_secret_basic']);
  });

  it('does not retry a public client', async () => {
    const attempts = stubPostOnlyTokenEndpoint();

    await expect(exchange({ clientId: 'cid' }, ['none'])).rejects.toThrow();
    expect(attempts).toEqual(['none']);
  });

  it('applies the same fallback to token refresh', async () => {
    const attempts = stubPostOnlyTokenEndpoint();

    const result = await refreshConnectorToken({
      authorizationServerUrl: 'https://auth.example.com',
      clientInformation: toClientInformation({ clientId: 'cid', clientSecret: 'secret' }),
      metadata: metadataWith(['client_secret_basic', 'client_secret_post']),
      refreshToken: 'rt',
    });

    expect(attempts).toEqual(['client_secret_basic', 'client_secret_post']);
    expect(result.authMethod).toBe('client_secret_post');
  });
});

describe('registeredAuthMethod', () => {
  it('prefers the method the server echoed back', () => {
    expect(
      registeredAuthMethod(
        { client_id: 'c', redirect_uris: [], token_endpoint_auth_method: 'client_secret_basic' },
        metadataWith(['client_secret_post', 'client_secret_basic']),
      ),
    ).toBe('client_secret_basic');
  });

  it('falls back to the requested method when the response omits it', () => {
    expect(
      registeredAuthMethod({ client_id: 'c', redirect_uris: [] }, metadataWith(['none'])),
    ).toBe('none');
  });
});

describe('SDK v2 OAuth regressions', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('retries invalid_client in an HTTP 200 OAuth error response', async () => {
    const attempts = stubPostOnlyTokenEndpoint(200);
    const result = await exchange({ clientId: 'cid', clientSecret: 'secret' }, [
      'client_secret_basic',
      'client_secret_post',
    ]);
    expect(attempts).toEqual(['client_secret_basic', 'client_secret_post']);
    expect(result.tokens.access_token).toBe('tok');
  });

  it('passes the authorization response issuer and rejects its absence when required', async () => {
    stubPostOnlyTokenEndpoint();
    const params = {
      authorizationCode: 'code',
      authorizationServerUrl: 'https://auth.example.com',
      clientInformation: toClientInformation({
        clientId: 'cid',
        clientSecret: 'secret',
        tokenEndpointAuthMethod: 'client_secret_post',
      }),
      codeVerifier: 'verifier',
      metadata: { ...metadataWith(), authorization_response_iss_parameter_supported: true },
      redirectUri: 'https://app.example.com/oauth/connector/callback',
    };
    await expect(
      exchangeConnectorCode({ ...params, iss: 'https://auth.example.com' }),
    ).resolves.toMatchObject({ tokens: { access_token: 'tok' } });
    await expect(exchangeConnectorCode(params)).rejects.toThrow('Issuer mismatch');
  });

  it('discovers a root issuer with a trailing slash when PRM is absent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        if (String(url).includes('oauth-authorization-server'))
          return Response.json({ ...metadataWith(), issuer: 'https://auth.example.com/' });
        return new Response(null, { status: 404 });
      }),
    );
    await expect(discoverConnectorOAuth('https://auth.example.com/mcp')).resolves.toMatchObject({
      authorizationServerUrl: 'https://auth.example.com/',
      metadata: { issuer: 'https://auth.example.com/' },
    });
  });

  it('keeps the authorization server registration error_description', async () => {
    vi.mocked(registerClient).mockRejectedValueOnce(
      new RegistrationRejectedError({
        status: 400,
        body: '{"error":"invalid_client_metadata","error_description":"Use a public client"}',
        submittedMetadata: { redirect_uris: [] },
      }),
    );
    await expect(
      registerDynamicClient({
        authorizationServerUrl: 'https://auth.example.com',
        metadata: metadataWith(),
        redirectUri: 'https://app.example.com/callback',
      }),
    ).rejects.toThrow('Use a public client');
  });
});

describe('OAuth metadata issuer validation', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('explains a mismatched discovery issuer without exposing the received value', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        if (String(url).includes('oauth-authorization-server'))
          return Response.json({ ...metadataWith(), issuer: 'https://untrusted.example/' });
        return new Response(null, { status: 404 });
      }),
    );
    await expect(discoverConnectorOAuth('https://auth.example.com/mcp')).rejects.toThrow(
      'Check the connector authorization server configuration.',
    );
  });
});
