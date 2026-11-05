// @vitest-environment node
import type * as BusinessConst from '@lobechat/business-const';
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
