import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const authHandler = vi.fn(async () => new Response(null));

  return {
    appEnv: { APP_URL: 'https://example.com' },
    authHandler,
    betterAuth: vi.fn((options) => ({ ...options, handler: authHandler })),
    clearMismatchedOIDCSession: vi.fn(),
    EnvHttpProxyAgent: vi.fn((options) => ({ options })),
    serverDB: {},
    setGlobalDispatcher: vi.fn(),
  };
});

vi.mock('@better-auth/expo', () => ({
  expo: vi.fn(() => ({ id: 'expo' })),
}));

vi.mock('@better-auth/passkey', () => ({
  passkey: vi.fn(() => ({ id: 'passkey' })),
}));

vi.mock('@lobechat/database', () => ({
  createNanoId: vi.fn(() => vi.fn(() => 'generated-id')),
  idGenerator: vi.fn(() => 'generated-user-id'),
  serverDB: mocks.serverDB,
}));

vi.mock('@lobechat/database/schemas', () => ({}));

vi.mock('bcryptjs', () => ({
  default: {
    compare: vi.fn(),
  },
}));

vi.mock('better-auth/adapters/drizzle', () => ({
  drizzleAdapter: vi.fn(() => ({ id: 'drizzle-adapter' })),
}));

vi.mock('better-auth/crypto', () => ({
  verifyPassword: vi.fn(),
}));

vi.mock('better-auth/minimal', () => ({
  betterAuth: mocks.betterAuth,
}));

vi.mock('better-auth/plugins', () => ({
  admin: vi.fn(() => ({ id: 'admin' })),
  emailOTP: vi.fn(() => ({ id: 'email-otp' })),
  genericOAuth: vi.fn(() => ({ id: 'generic-oauth' })),
  magicLink: vi.fn(() => ({ id: 'magic-link' })),
}));

vi.mock('undici', () => ({
  EnvHttpProxyAgent: mocks.EnvHttpProxyAgent,
  setGlobalDispatcher: mocks.setGlobalDispatcher,
}));

vi.mock('@/envs/app', () => ({
  appEnv: mocks.appEnv,
}));

vi.mock('@/envs/auth', () => ({
  authEnv: {
    AUTH_DISABLE_EMAIL_PASSWORD: false,
    AUTH_EMAIL_VERIFICATION: true,
    AUTH_ENABLE_MAGIC_LINK: false,
    AUTH_SECRET: 'test-secret',
    AUTH_SSO_PROVIDERS: '',
  },
}));

vi.mock('@/libs/better-auth/email-templates', () => ({
  getChangeEmailVerificationTemplate: vi.fn(() => ({})),
  getMagicLinkEmailTemplate: vi.fn(() => ({})),
  getResetPasswordEmailTemplate: vi.fn(() => ({})),
  getVerificationEmailTemplate: vi.fn(() => ({})),
  getVerificationOTPEmailTemplate: vi.fn(() => ({})),
}));

vi.mock('@/libs/better-auth/plugins/email-whitelist', () => ({
  emailWhitelist: vi.fn(() => ({ id: 'email-whitelist' })),
}));

vi.mock('@/libs/better-auth/sso', () => ({
  initBetterAuthSSOProviders: vi.fn(() => ({
    genericOAuthProviders: [],
    socialProviders: {},
  })),
}));

vi.mock('@/libs/better-auth/utils/config', () => ({
  createSecondaryStorage: vi.fn(() => ({ id: 'secondary-storage' })),
  getTrustedOrigins: vi.fn(() => ['https://example.com']),
}));

vi.mock('@/libs/better-auth/utils/server', () => ({
  parseSSOProviders: vi.fn(() => []),
}));

vi.mock('@/libs/oidc-provider/session-cleanup', () => ({
  clearMismatchedOIDCSession: mocks.clearMismatchedOIDCSession,
}));

vi.mock('@/server/services/email', () => ({
  EmailService: vi.fn(),
}));

vi.mock('@/server/services/user', () => ({
  UserService: vi.fn(),
}));

const createResponseWithCookie = (cookie: string) => {
  const response = new Response(null);
  response.headers.append('set-cookie', cookie);

  return response;
};

describe('defineConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mocks.appEnv.APP_URL = 'https://example.com';
    process.env = { ...originalEnv, NODE_ENV: 'test' };
    delete process.env.HTTP_PROXY;
    delete process.env.http_proxy;
    delete process.env.HTTPS_PROXY;
    delete process.env.https_proxy;
    delete process.env.NO_PROXY;
    delete process.env.no_proxy;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = originalEnv;
  });

  it('should revoke existing sessions after password reset by default', async () => {
    const { defineConfig } = await import('./define-config');

    defineConfig({ plugins: [] });

    expect(mocks.betterAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        emailAndPassword: expect.objectContaining({
          revokeSessionsOnPasswordReset: true,
        }),
      }),
    );
  });

  it('should clear a mismatched OIDC session before creating a Better Auth session', async () => {
    const { defineConfig } = await import('./define-config');
    const context = { getCookie: vi.fn(), setCookie: vi.fn() };

    defineConfig({ plugins: [] });
    const [options] = mocks.betterAuth.mock.lastCall!;
    await options.databaseHooks.session.create.before({ userId: 'user-b' }, context);

    expect(mocks.clearMismatchedOIDCSession).toHaveBeenCalledWith(
      mocks.serverDB,
      'user-b',
      context,
    );
  });

  it('should continue creating the Better Auth session when OIDC cleanup fails', async () => {
    const cleanupError = new Error('OIDC database unavailable');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.clearMismatchedOIDCSession.mockRejectedValueOnce(cleanupError);
    const { defineConfig } = await import('./define-config');

    defineConfig({ plugins: [] });
    const [options] = mocks.betterAuth.mock.lastCall!;

    await expect(
      options.databaseHooks.session.create.before({ userId: 'user-b' }, null),
    ).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalledWith(
      '[Better Auth] Failed to clear a stale OIDC session:',
      cleanupError,
    );
  });

  it('should respect NO_PROXY when configuring the development proxy dispatcher', async () => {
    process.env = {
      ...process.env,
      HTTP_PROXY: 'http://127.0.0.1:7890',
      HTTPS_PROXY: 'http://127.0.0.1:7890',
      NODE_ENV: 'development',
      NO_PROXY: 'example.com,localhost',
    };

    await import('./define-config');

    expect(mocks.EnvHttpProxyAgent).toHaveBeenCalledWith({
      httpProxy: 'http://127.0.0.1:7890',
      httpsProxy: 'http://127.0.0.1:7890',
      noProxy: 'example.com,localhost,127.0.0.1,[::1]',
    });
    expect(mocks.setGlobalDispatcher).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          noProxy: 'example.com,localhost,127.0.0.1,[::1]',
        }),
      }),
    );
  });

  it('should preserve NO_PROXY wildcard semantics', async () => {
    const { mergeLocalNoProxy } = await import('./define-config');

    expect(mergeLocalNoProxy('*')).toBe('*');
  });

  it('should keep auth cookies host-only when no cookie domain is given', async () => {
    const { defineConfig } = await import('./define-config');

    defineConfig({ plugins: [] });
    const [options] = mocks.betterAuth.mock.lastCall!;

    expect(options.advanced.crossSubDomainCookies).toBeUndefined();
  });

  it('should namespace every Better Auth cookie with the configured prefix', async () => {
    const { defineConfig } = await import('./define-config');

    defineConfig({ cookiePrefix: 'example-app', plugins: [] });
    const [options] = mocks.betterAuth.mock.lastCall!;

    expect(options.advanced.cookiePrefix).toBe('example-app');
  });

  it.each([['https://app.example.com'], ['https://example.com']])(
    'should share auth cookies across subdomains when APP_URL %s is under the cookie domain',
    async (appUrl) => {
      mocks.appEnv.APP_URL = appUrl;
      const { defineConfig } = await import('./define-config');

      defineConfig({ cookieDomain: '.example.com', plugins: [] });
      const [options] = mocks.betterAuth.mock.lastCall!;

      expect(options.advanced.crossSubDomainCookies).toEqual({
        domain: '.example.com',
        enabled: true,
      });
    },
  );

  it.each([['https://preview-branch.vercel.app'], ['http://localhost:3010']])(
    'should ignore a cookie domain that APP_URL %s does not belong to',
    async (appUrl) => {
      mocks.appEnv.APP_URL = appUrl;
      const { defineConfig } = await import('./define-config');

      defineConfig({ cookieDomain: '.example.com', plugins: [] });
      const [options] = mocks.betterAuth.mock.lastCall!;

      expect(options.advanced.crossSubDomainCookies).toBeUndefined();
    },
  );

  it('should expire the legacy host-only twin of every domain-scoped cookie', async () => {
    mocks.appEnv.APP_URL = 'https://app.example.com';
    mocks.authHandler.mockResolvedValueOnce(
      createResponseWithCookie(
        '__Secure-better-auth.session_token=token; Path=/; Domain=.example.com; HttpOnly; Secure; SameSite=Lax',
      ),
    );
    const { defineConfig } = await import('./define-config');

    const auth = defineConfig({ cookieDomain: '.example.com', plugins: [] });
    const response = await auth.handler(
      new Request('https://app.example.com/api/auth/get-session'),
    );

    expect(response.headers.getSetCookie()).toEqual([
      '__Secure-better-auth.session_token=token; Path=/; Domain=.example.com; HttpOnly; Secure; SameSite=Lax',
      '__Secure-better-auth.session_token=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax; HttpOnly; Secure',
    ]);
  });

  it('should leave cookies alone when no cookie domain is configured', async () => {
    mocks.authHandler.mockResolvedValueOnce(
      createResponseWithCookie('__Secure-better-auth.session_token=token; Path=/; Secure'),
    );
    const { defineConfig } = await import('./define-config');

    const auth = defineConfig({ plugins: [] });
    const response = await auth.handler(
      new Request('https://app.example.com/api/auth/get-session'),
    );

    expect(response.headers.getSetCookie()).toEqual([
      '__Secure-better-auth.session_token=token; Path=/; Secure',
    ]);
  });
});
