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

// Passkeys derive their rpID from APP_URL. Without it the WebAuthn ceremony
// cannot complete, so the client must not advertise passkeys at all — a visible
// but non-functional button is worse than no button.
describe('getServerAuthConfig / enablePasskey', () => {
  it('disables passkeys when APP_URL is not configured', async () => {
    mocks.appEnv.APP_URL = undefined;
    vi.resetModules();

    const { getServerAuthConfig } = await import('./getServerAuthConfig');

    expect(getServerAuthConfig().enablePasskey).toBe(false);
  });

  it('enables passkeys once APP_URL is set', async () => {
    mocks.appEnv.APP_URL = 'https://chat.example.com';
    vi.resetModules();

    const { getServerAuthConfig } = await import('./getServerAuthConfig');

    expect(getServerAuthConfig().enablePasskey).toBe(true);
  });
});
