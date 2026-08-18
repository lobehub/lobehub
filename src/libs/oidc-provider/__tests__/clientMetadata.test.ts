import { describe, expect, it, vi } from 'vitest';

vi.mock('@/envs/app', () => ({
  appEnv: { APP_URL: 'https://deploy.example.com', MARKET_BASE_URL: undefined },
}));

const loadClients = async (branding: { logo: string; name: string }) => {
  vi.resetModules();
  vi.doMock('@lobechat/business-const', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    BRANDING_LOGO_URL: branding.logo,
    BRANDING_NAME: branding.name,
  }));

  const { defaultClients } = await import('../config');
  return defaultClients;
};

/**
 * These fields are not internal metadata: oidc-provider validates them when it
 * registers the clients, and the consent screen renders them to the user.
 *
 * The failure this guards is the nastiest shape available — it builds, it
 * deploys, and then every single authorization request dies with
 * `invalid_client_metadata: logo_uri must be a web uri` before any screen is
 * drawn. Nothing upstream of the login attempt notices.
 */
describe('OIDC client metadata', () => {
  it('makes a site-relative branding logo absolute', async () => {
    const clients = await loadClients({ logo: '/branding/logo.png', name: 'Acme' });

    expect(clients.length).toBeGreaterThan(0);
    for (const client of clients) {
      expect(client.logo_uri).toBe('https://deploy.example.com/branding/logo.png');
    }
  });

  it('passes an absolute branding logo through unchanged', async () => {
    const clients = await loadClients({ logo: 'https://cdn.acme.test/mark.png', name: 'Acme' });

    for (const client of clients) {
      expect(client.logo_uri).toBe('https://cdn.acme.test/mark.png');
    }
  });

  it('keeps each client’s own default when no branding logo is set', async () => {
    const clients = await loadClients({ logo: '', name: 'LobeHub' });

    // Per-client, not one shared URL — mobile ships a different mark, and
    // collapsing them would silently change the default build's consent screen.
    const logos = new Set(clients.map((client) => client.logo_uri));
    expect(logos.size).toBeGreaterThan(1);
    for (const client of clients) {
      expect(client.logo_uri).toMatch(/^https:\/\//);
    }
  });

  it('names every client after the brand', async () => {
    const clients = await loadClients({ logo: '/branding/logo.png', name: 'Acme' });

    for (const client of clients) {
      expect(client.client_name).toMatch(/^Acme /);
    }
  });

  it('emits only absolute http(s) URIs, whatever the branding', async () => {
    for (const logo of ['', '/branding/logo.png', 'https://cdn.acme.test/m.png']) {
      const clients = await loadClients({ logo, name: 'Acme' });
      for (const client of clients) {
        expect(() => new URL(String(client.logo_uri))).not.toThrow();
        expect(String(client.logo_uri)).toMatch(/^https?:\/\//);
      }
    }
  });
});
