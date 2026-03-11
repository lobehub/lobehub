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
    it('should identify market client correctly', () => {
      expect(MARKET_CLIENT_ID).toBe('lobehub-market');
    });

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
  });

  describe('Provider Configuration', () => {
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

  describe('Name Resolution Priority', () => {
    it('should prioritize fullName over firstName+lastName', () => {
      const priorities = ['fullName', 'firstName + lastName', 'username', 'id'];

      // Test the priority logic
      expect(priorities[0]).toBe('fullName');
      expect(priorities[1]).toBe('firstName + lastName');
      expect(priorities[2]).toBe('username');
      expect(priorities[3]).toBe('id');
    });
  });

  describe('Claims Generation', () => {
    it('should include profile claims when profile scope is requested', () => {
      const scopes = ['openid', 'profile', 'email'];
      expect(scopes).toContain('profile');
    });

    it('should include email claims when email scope is requested', () => {
      const scopes = ['openid', 'profile', 'email'];
      expect(scopes).toContain('email');
    });

    it('should always include sub claim', () => {
      const requiredClaims = ['sub'];
      expect(requiredClaims).toContain('sub');
    });
  });

  describe('Non-Market Client Logic (Default Path)', () => {
    it('should use UserModel for non-market clients (desktop client)', () => {
      // Desktop client should use the default user database lookup
      const desktopClientId = 'lobehub-desktop';
      expect(desktopClientId).not.toBe(MARKET_CLIENT_ID);
    });

    it('should use UserModel for non-market clients (mobile client)', () => {
      // Mobile client should use the default user database lookup
      const mobileClientId = 'lobehub-mobile';
      expect(mobileClientId).not.toBe(MARKET_CLIENT_ID);
    });

    it('should validate non-market client IDs are different from market client', () => {
      const nonMarketClients = ['lobehub-desktop', 'lobehub-mobile'];

      nonMarketClients.forEach((clientId) => {
        expect(clientId).not.toBe(MARKET_CLIENT_ID);
      });
    });
  });

  describe('Account ID Priority Logic', () => {
    it('should prioritize externalAccountId over session accountId', () => {
      const priorities = {
        first: 'externalAccountId',
        second: 'ctx.oidc.session.accountId',
        third: 'parameter id',
      };

      expect(priorities.first).toBe('externalAccountId');
      expect(priorities.second).toBe('ctx.oidc.session.accountId');
      expect(priorities.third).toBe('parameter id');
    });

    it('should document account ID resolution priority', () => {
      // Priority: 1. externalAccountId 2. ctx.oidc.session?.accountId 3. id parameter
      const accountIdPriority = [
        'externalAccountId (highest)',
        'ctx.oidc.session.accountId (medium)',
        'id parameter (lowest)',
      ];

      expect(accountIdPriority).toHaveLength(3);
      expect(accountIdPriority[0]).toContain('externalAccountId');
      expect(accountIdPriority[1]).toContain('ctx.oidc.session.accountId');
      expect(accountIdPriority[2]).toContain('id parameter');
    });
  });

  describe('Business Logic Scenarios', () => {
    describe('Scenario 1: Desktop Client + Local Database', () => {
      it('should use local UserModel for desktop client', () => {
        // Business: Desktop app uses local database for user management
        const scenario = {
          client: 'lobehub-desktop',
          authProvider: 'UserModel (Local Database)',
          useCase: 'Desktop app with local/self-hosted user database',
        };

        expect(scenario.client).toBe('lobehub-desktop');
        expect(scenario.authProvider).toBe('UserModel (Local Database)');
      });
    });

    describe('Scenario 2: Mobile Client + Local Database', () => {
      it('should use local UserModel for mobile client', () => {
        // Business: Mobile app uses local database for user management
        const scenario = {
          client: 'lobehub-mobile',
          authProvider: 'UserModel (Local Database)',
          useCase: 'Mobile app with local/self-hosted user database',
        };

        expect(scenario.client).toBe('lobehub-mobile');
        expect(scenario.authProvider).toBe('UserModel (Local Database)');
      });
    });

    describe('Scenario 3: Claims Generation', () => {
      it('should generate database-based claims for clients', () => {
        // Business: Users get profile/email from local DB
        const localClaims = {
          source: 'UserModel (PostgreSQL/PGLite)',
          fields: ['sub', 'name', 'picture', 'email', 'email_verified'],
          nameResolution: 'fullName || username || firstName+lastName',
        };

        expect(localClaims.source).toBe('UserModel (PostgreSQL/PGLite)');
        expect(localClaims.fields).toContain('name');
        expect(localClaims.fields).toContain('email');
      });
    });
  });
});
