// @vitest-environment node
import type * as BusinessConst from '@lobechat/business-const';
import { API_KEY_FULL_ACCESS_SCOPE, API_KEY_SCOPES } from '@lobechat/const';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The consent screen shows these names to the person signing in, so they name
// the deployment's own app rather than the upstream product.
const loadClientNames = async (branding?: Partial<typeof BusinessConst>) => {
  vi.resetModules();
  if (branding) {
    vi.doMock('@lobechat/business-const', async (importOriginal) => ({
      ...(await importOriginal<typeof BusinessConst>()),
      ...branding,
    }));
    // Under vitest 5 a `doMock` only lands once the test file itself imports
    // something, so pull the mocked module in before the one under test.
    await import('@lobechat/business-const');
  }
  const { defaultClients } = await import('./config');
  return Object.fromEntries(defaultClients.map((c) => [c.client_id, c.client_name]));
};

afterEach(() => {
  vi.doUnmock('@lobechat/business-const');
  vi.resetModules();
});

describe('OIDC default clients', () => {
  it('keep the upstream names under default branding', async () => {
    const names = await loadClientNames();

    expect(names['lobehub-desktop']).toBe('LobeHub Desktop');
    expect(names['lobehub-mobile']).toBe('LobeHub Mobile');
  });

  it("name the deployment's own desktop and mobile apps under custom branding", async () => {
    const names = await loadClientNames({ BRANDING_NAME: 'Acme' });

    expect(names['lobehub-desktop']).toBe('Acme Desktop');
    expect(names['lobehub-mobile']).toBe('Acme Mobile');
  });

  it('register the browser extension as a public PKCE client that can stay signed in', async () => {
    vi.resetModules();
    const { defaultClients } = await import('./config');
    const client = defaultClients.find((c) => c.client_id === 'lobehub-acceptance-extension');

    expect(client).toMatchObject({
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    });
    expect(client?.redirect_uris).toContain(
      'https://fjgpjfdackkmgdldjiebkhkdacbibhnb.chromiumapp.org/oidc',
    );
    expect(client?.scope?.split(' ')).toEqual(
      expect.arrayContaining(['openid', 'profile', 'offline_access', 'acceptance:extension']),
    );
  });
});

describe('distribution OIDC clients', () => {
  const nativeClient = {
    application_type: 'native' as const,
    client_id: 'native-app',
    grant_types: ['authorization_code', 'refresh_token'],
    redirect_uris: ['http://127.0.0.1/callback'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  };

  const loadClients = async (clients: BusinessConst.BusinessOidcClientMetadata[]) => {
    vi.resetModules();
    vi.doMock('@lobechat/business-const', async (importOriginal) => ({
      ...(await importOriginal<typeof BusinessConst>()),
      BUSINESS_OIDC_CLIENTS: clients,
    }));
    await import('@lobechat/business-const');
    return import('./config');
  };

  it('registers nothing extra by default', async () => {
    const { defaultClients } = await import('./config');

    expect(defaultClients.map((client) => client.client_id)).not.toContain('native-app');
  });

  it('appends the business slot clients after the built-in ones', async () => {
    const { defaultClients } = await loadClients([nativeClient]);

    expect(defaultClients.at(-1)).toEqual(nativeClient);
    expect(defaultClients[0].client_id).toBe('lobehub-desktop');
  });

  it('refuses a business client that reuses a built-in client id', async () => {
    await expect(loadClients([{ ...nativeClient, client_id: 'lobehub-desktop' }])).rejects.toThrow(
      'OIDC client "lobehub-desktop" is registered more than once',
    );
  });
});

describe('OIDC scope catalog', () => {
  it('offers only the OIDC scopes while API scopes are switched off', async () => {
    const { buildDefaultScopes } = await import('./config');
    const scopes = buildDefaultScopes(false);

    expect(scopes).toEqual(
      expect.arrayContaining(['openid', 'profile', 'email', 'offline_access']),
    );
    expect(scopes).not.toContain('agent:read');
    expect(scopes).not.toContain('*');
  });

  it('adds every API key scope once the server enables them, never full access', async () => {
    const { buildDefaultScopes } = await import('./config');
    const scopes = buildDefaultScopes(true);

    // The REST app registration accepts exactly this catalog; anything it
    // accepts but the provider does not list would only fail later, at login.
    for (const scope of API_KEY_SCOPES) {
      if (scope === API_KEY_FULL_ACCESS_SCOPE) continue;
      expect(scopes).toContain(scope);
    }
    expect(scopes).not.toContain(API_KEY_FULL_ACCESS_SCOPE);
  });

  it('reads OIDC_ENABLE_API_SCOPES when the provider configuration loads', async () => {
    vi.resetModules();
    vi.stubEnv('OIDC_ENABLE_API_SCOPES', '1');
    const { defaultScopes } = await import('./config');

    expect(defaultScopes).toContain('agent:read');
    vi.unstubAllEnvs();
    vi.resetModules();
  });
});
