import { registerClient } from '@modelcontextprotocol/sdk/client/auth.js';
import type { AuthorizationServerMetadata } from '@modelcontextprotocol/sdk/shared/auth.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerDynamicClient, selectRegistrationAuthMethod } from './oauth';

vi.mock('@modelcontextprotocol/sdk/client/auth.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  registerClient: vi.fn(),
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
