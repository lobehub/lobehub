import type {
  AuthorizationServerMetadata,
  OAuthClientInformationFull,
  OAuthClientMetadata,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerDynamicClient } from './oauth';

vi.mock('@/envs/app', () => ({
  appEnv: { APP_URL: 'https://app.example.com' },
}));

const authorizationServerUrl = 'https://auth.example.com';
const redirectUri = 'https://app.example.com/oauth/connector/callback';

const createMetadata = (
  overrides: Partial<AuthorizationServerMetadata> = {},
): AuthorizationServerMetadata => ({
  authorization_endpoint: `${authorizationServerUrl}/authorize`,
  issuer: authorizationServerUrl,
  registration_endpoint: `${authorizationServerUrl}/register`,
  response_types_supported: ['code'],
  token_endpoint: `${authorizationServerUrl}/token`,
  ...overrides,
});

const registeredClient: OAuthClientInformationFull = {
  client_id: 'registered-client',
  redirect_uris: [redirectUri],
};

const getRegistrationMetadata = async (
  metadata: AuthorizationServerMetadata,
): Promise<OAuthClientMetadata> => {
  await registerDynamicClient({
    authorizationServerUrl,
    metadata,
    redirectUri,
  });

  const [requestUrl, request] = vi.mocked(fetch).mock.calls.at(-1) ?? [];
  if (String(requestUrl) !== `${authorizationServerUrl}/register`) {
    throw new Error('Expected the dynamic registration endpoint to be called');
  }
  if (typeof request?.body !== 'string') {
    throw new Error('Expected dynamic client metadata in the request body');
  }

  return JSON.parse(request.body);
};

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(
      async () =>
        new Response(JSON.stringify(registeredClient), {
          headers: { 'content-type': 'application/json' },
          status: 201,
        }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('registerDynamicClient', () => {
  it('registers a public client when the server only supports none', async () => {
    const metadata = await getRegistrationMetadata(
      createMetadata({
        token_endpoint_auth_methods_supported: ['none'],
      }),
    );

    expect(metadata.token_endpoint_auth_method).toBe('none');
  });

  it('keeps confidential client_secret_post registration when it is the only supported method', async () => {
    const metadata = await getRegistrationMetadata(
      createMetadata({
        token_endpoint_auth_methods_supported: ['client_secret_post'],
      }),
    );

    expect(metadata.token_endpoint_auth_method).toBe('client_secret_post');
  });

  it('uses client_secret_basic when it is the only supported confidential method', async () => {
    const metadata = await getRegistrationMetadata(
      createMetadata({
        token_endpoint_auth_methods_supported: ['client_secret_basic'],
      }),
    );

    expect(metadata.token_endpoint_auth_method).toBe('client_secret_basic');
  });

  it('prefers a public client when both none and client_secret_post are supported', async () => {
    const metadata = await getRegistrationMetadata(
      createMetadata({
        token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
      }),
    );

    expect(metadata.token_endpoint_auth_method).toBe('none');
  });

  it('preserves client_secret_post when auth-method metadata is missing', async () => {
    const metadata = await getRegistrationMetadata(createMetadata());

    expect(metadata.token_endpoint_auth_method).toBe('client_secret_post');
  });

  it('rejects servers that advertise only unsupported token endpoint auth methods', async () => {
    await expect(
      registerDynamicClient({
        authorizationServerUrl,
        metadata: createMetadata({
          token_endpoint_auth_methods_supported: ['private_key_jwt'],
        }),
        redirectUri,
      }),
    ).rejects.toThrow(
      'Incompatible auth server: unsupported token endpoint auth methods: private_key_jwt',
    );

    expect(fetch).not.toHaveBeenCalled();
  });

  it('requests refresh_token only when the server advertises it', async () => {
    const authorizationCodeOnly = await getRegistrationMetadata(
      createMetadata({
        grant_types_supported: ['authorization_code'],
      }),
    );
    const withRefreshToken = await getRegistrationMetadata(
      createMetadata({
        grant_types_supported: ['authorization_code', 'refresh_token'],
      }),
    );
    const missingGrantMetadata = await getRegistrationMetadata(createMetadata());

    expect(authorizationCodeOnly.grant_types).toEqual(['authorization_code']);
    expect(withRefreshToken.grant_types).toEqual(['authorization_code', 'refresh_token']);
    expect(missingGrantMetadata.grant_types).toEqual(['authorization_code']);
  });
});
