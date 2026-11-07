/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dependencies

vi.mock('@/envs/app', () => ({
  appEnv: {
    APP_URL: 'https://example.com',
    MARKET_BASE_URL: undefined,
  },
}));

vi.mock('@/config/db', () => ({
  serverDBEnv: {
    KEY_VAULTS_SECRET: 'test-secret-key',
  },
}));

vi.mock('debug', () => ({
  default: () => vi.fn(),
}));

describe('OIDC Provider - Market Client Integration', () => {
  const MARKET_CLIENT_ID = 'lobehub-market';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetModules();
  });

  describe('Market Client Logic', () => {
    it('should have market client in default clients', async () => {
      vi.doMock('@/envs/app', () => ({
        appEnv: {
          APP_URL: 'https://example.com',
          MARKET_BASE_URL: 'https://market.lobehub.com',
        },
      }));

      const { defaultClients } = await import('./config');
      const marketClient = defaultClients.find((c) => c.client_id === MARKET_CLIENT_ID);

      expect(marketClient).toBeDefined();
      expect(marketClient?.client_id).toBe('lobehub-market');
      expect(marketClient?.client_name).toBe('LobeHub Marketplace');

      vi.doUnmock('@/envs/app');
    });

    it('names the acceptance toolbar client after the product people see', async () => {
      vi.doMock('@/envs/app', () => ({
        appEnv: { APP_URL: 'https://example.com' },
      }));

      const { defaultClients } = await import('./config');
      const client = defaultClients.find((c) => c.client_id === 'lobehub-acceptance');

      expect(client?.client_name).toBe('LobeHub Acceptance');
      expect(client?.redirect_uris).toEqual(['https://example.com/oidc/acceptance/callback']);

      vi.doUnmock('@/envs/app');
    });
  });

  describe('Provider Configuration', () => {
    it('should accept both Cloud desktop callback origins during the apex migration', async () => {
      vi.doMock('@/envs/app', () => ({
        appEnv: {
          APP_URL: 'https://app.lobehub.com',
          MARKET_BASE_URL: undefined,
        },
      }));

      const { default: Provider } = await import('oidc-provider');
      const { defaultClients } = await import('./config');
      const provider = new Provider('https://app.lobehub.com/oidc', { clients: defaultClients });
      const desktopClient = await provider.Client.find('lobehub-desktop');

      expect(
        desktopClient?.redirectUriAllowed('https://app.lobehub.com/oidc/callback/desktop'),
      ).toBe(true);
      expect(desktopClient?.redirectUriAllowed('https://lobehub.com/oidc/callback/desktop')).toBe(
        true,
      );
      expect(desktopClient?.redirectUriAllowed('https://example.com/oidc/callback/desktop')).toBe(
        false,
      );

      vi.doUnmock('@/envs/app');
    });

    it('should register toby as a public native client with an https callback only', async () => {
      vi.doMock('@/envs/app', () => ({
        appEnv: {
          APP_URL: 'https://app.lobehub.com',
          MARKET_BASE_URL: undefined,
        },
      }));

      const { default: Provider } = await import('oidc-provider');
      const { defaultClients } = await import('./config');
      const provider = new Provider('https://app.lobehub.com/oidc', { clients: defaultClients });
      const tobyClient = await provider.Client.find('toby');

      expect(tobyClient?.applicationType).toBe('native');
      expect(tobyClient?.tokenEndpointAuthMethod).toBe('none');
      expect(tobyClient?.grantTypes).toEqual(['authorization_code', 'refresh_token']);
      expect(tobyClient?.redirectUriAllowed('https://app.lobehub.com/oidc/callback/toby')).toBe(
        true,
      );
      expect(tobyClient?.redirectUriAllowed('https://lobehub.com/oidc/callback/toby')).toBe(true);
      expect(tobyClient?.redirectUriAllowed('com.lobehub.toby://auth/callback')).toBe(false);
      expect(tobyClient?.redirectUriAllowed('https://example.com/oidc/callback/toby')).toBe(false);

      vi.doUnmock('@/envs/app');
    });

    it('should export API_AUDIENCE constant', async () => {
      vi.doMock('@/envs/app', () => ({
        appEnv: {
          APP_URL: 'https://example.com',
          MARKET_BASE_URL: undefined,
        },
      }));

      const module = await import('./provider');
      expect(module.API_AUDIENCE).toBe('urn:lobehub:chat');

      vi.doUnmock('@/envs/app');
    }, 10000);

    it('should define numeric TTLs for all OIDC provider artifacts', async () => {
      vi.doMock('@/envs/app', () => ({
        appEnv: {
          APP_URL: 'https://example.com',
          MARKET_BASE_URL: undefined,
        },
      }));

      const module = await import('./provider');

      expect(module.oidcArtifactTTL).toEqual({
        AccessToken: 7 * 24 * 60 * 60,
        AuthorizationCode: 600,
        BackchannelAuthenticationRequest: 600,
        ClientCredentials: 600,
        DeviceCode: 600,
        Grant: 100 * 365 * 24 * 60 * 60,
        IdToken: 3600,
        Interaction: 3600,
        RefreshToken: 30 * 24 * 60 * 60,
        Session: 30 * 24 * 60 * 60,
      });

      for (const ttl of Object.values(module.oidcArtifactTTL)) {
        expect(typeof ttl).toBe('number');
        expect(Number.isSafeInteger(ttl)).toBe(true);
        expect(ttl).toBeGreaterThan(0);
      }

      vi.doUnmock('@/envs/app');
    }, 10000);

    it('never lets the grant be what ends an active session', async () => {
      vi.doMock('@/envs/app', () => ({
        appEnv: {
          APP_URL: 'https://example.com',
          MARKET_BASE_URL: undefined,
        },
      }));

      const { oidcArtifactTTL } = await import('./provider');
      const fiftyYears = 50 * 365 * 24 * 60 * 60;

      /**
       * oidc-provider never extends `Grant.exp` on refresh, so a grant TTL anywhere near a
       * realistic account lifetime is a hard logout deadline for every client of that account
       * — a refresh that lands after it fails with `invalid_grant` even though the refresh
       * token itself is unused and unexpired. Only `RefreshToken` may bound a session.
       */
      expect(oidcArtifactTTL.Grant).toBeGreaterThan(fiftyYears);
      expect(oidcArtifactTTL.Grant).toBeGreaterThan(oidcArtifactTTL.RefreshToken);

      vi.doUnmock('@/envs/app');
    }, 10000);

    it('should have createOIDCProvider function', async () => {
      vi.doMock('@/envs/app', () => ({
        appEnv: {
          APP_URL: 'https://example.com',
          MARKET_BASE_URL: undefined,
        },
      }));

      const module = await import('./provider');
      expect(module.createOIDCProvider).toBeDefined();
      expect(typeof module.createOIDCProvider).toBe('function');

      vi.doUnmock('@/envs/app');
    }, 10000);
  });
});
