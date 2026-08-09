import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  appEnv: { APP_URL: undefined as string | undefined },
}));

vi.mock('@/envs/app', () => ({ appEnv: mocks.appEnv }));
vi.mock('@/envs/auth', () => ({
  authEnv: {
    AUTH_DISABLE_EMAIL_PASSWORD: false,
    AUTH_EMAIL_VERIFICATION: false,
    AUTH_ENABLE_MAGIC_LINK: false,
    AUTH_SSO_PROVIDERS: '',
  },
}));
vi.mock('@lobechat/business-const', () => ({ ENABLE_BUSINESS_FEATURES: false }));
vi.mock('@/libs/better-auth/utils/server', () => ({ parseSSOProviders: () => [] }));

// APP_URL always resolves to a value (it falls back to localhost) and is only
// validated as a plain string, so the flag has to check that the origin is one
// a WebAuthn ceremony could actually use — HTTPS, or loopback.
describe('getServerAuthConfig / enablePasskey', () => {
  const load = async (appUrl?: string, vercel = false) => {
    if (appUrl) process.env.APP_URL = appUrl;
    else delete process.env.APP_URL;
    if (vercel) process.env.VERCEL = '1';
    else delete process.env.VERCEL;

    // The helper reads the resolved value, which app.ts derives from both.
    mocks.appEnv.APP_URL = appUrl ?? (vercel ? 'https://preview.vercel.app' : undefined);
    vi.resetModules();

    const { getServerAuthConfig } = await import('./getServerAuthConfig');

    return getServerAuthConfig();
  };

  it('disables passkeys when APP_URL is not configured', async () => {
    expect((await load()).enablePasskey).toBe(false);
  });

  // Vercel derives a real public URL from its own variables, so those
  // deployments must not be treated as the implicit localhost fallback.
  it('enables passkeys on Vercel without an explicit APP_URL', async () => {
    expect((await load(undefined, true)).enablePasskey).toBe(true);
  });

  it('enables passkeys once APP_URL is set', async () => {
    expect((await load('https://chat.example.com')).enablePasskey).toBe(true);
  });

  // A plain-HTTP public origin is not a secure context, so every ceremony
  // would fail even though the variable is set.
  it('rejects a plain-http public origin', async () => {
    expect((await load('http://chat.example.com')).enablePasskey).toBe(false);
  });

  it('allows loopback, which is a secure context', async () => {
    expect((await load('http://localhost:3210')).enablePasskey).toBe(true);
  });

  // URL.hostname keeps the brackets for IPv6, so a naive '::1' comparison
  // would reject a perfectly usable loopback origin.
  it('allows bracketed IPv6 loopback', async () => {
    expect((await load('http://[::1]:3210')).enablePasskey).toBe(true);
  });

  it('rejects a malformed APP_URL', async () => {
    expect((await load('not a url')).enablePasskey).toBe(false);
  });
});
