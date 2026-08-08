/**
 * AICO-102 practical security-control tests (defensive — no exploit payloads).
 * Phone login gate: see phone-login-gate.test.ts. Open redirect: onboardingRedirect.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isSafeRedirectPath, sanitizeRedirectPath } from '@/utils/onboardingRedirect';

const mocks = vi.hoisted(() => ({
  betterAuth: vi.fn((options) => options),
  clearMismatchedOIDCSession: vi.fn(),
  EnvHttpProxyAgent: vi.fn((options) => ({ options })),
  serverDB: {},
  setGlobalDispatcher: vi.fn(),
}));

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
  default: { compare: vi.fn() },
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
  emailOTP: vi.fn((opts) => ({ id: 'email-otp', options: opts })),
  genericOAuth: vi.fn(() => ({ id: 'generic-oauth' })),
  magicLink: vi.fn(() => ({ id: 'magic-link' })),
  phoneNumber: vi.fn((opts) => ({ id: 'phone-number', options: opts })),
}));

vi.mock('undici', () => ({
  EnvHttpProxyAgent: mocks.EnvHttpProxyAgent,
  setGlobalDispatcher: mocks.setGlobalDispatcher,
}));

vi.mock('@/envs/app', () => ({
  appEnv: { APP_URL: 'https://example.com' },
}));

vi.mock('@/envs/auth', () => ({
  authEnv: {
    AUTH_DISABLE_EMAIL_PASSWORD: false,
    AUTH_EMAIL_VERIFICATION: false,
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

vi.mock('@/libs/better-auth/phone', () => ({
  isValidIranianPhoneNumber: vi.fn(() => true),
  normalizeIranianPhoneNumber: vi.fn((v: string) => v),
}));

vi.mock('@/libs/better-auth/plugins/aico-ban-message', () => ({
  aicoBanMessage: vi.fn(() => ({ id: 'aico-ban-message' })),
}));

vi.mock('@/libs/better-auth/plugins/email-whitelist', () => ({
  emailWhitelist: vi.fn(() => ({ id: 'email-whitelist' })),
}));

vi.mock('@/libs/better-auth/plugins/phone-login-gate', () => ({
  phoneLoginGate: vi.fn(() => ({ id: 'phone-login-gate' })),
}));

vi.mock('@/libs/better-auth/sso', () => ({
  initBetterAuthSSOProviders: vi.fn(() => ({
    genericOAuthProviders: [],
    socialProviders: {},
  })),
}));

vi.mock('@/libs/better-auth/utils/config', () => ({
  createSecondaryStorage: vi.fn(),
  getTrustedOrigins: vi.fn(() => ['https://example.com']),
}));

vi.mock('@/libs/better-auth/utils/server', () => ({
  parseSSOProviders: vi.fn(() => []),
}));

vi.mock('@/libs/oidc-provider/session-cleanup', () => ({
  clearMismatchedOIDCSession: mocks.clearMismatchedOIDCSession,
}));

vi.mock('@/server/services/email', () => ({
  EmailService: vi.fn().mockImplementation(() => ({ sendMail: vi.fn() })),
}));

vi.mock('@/server/services/sms', () => ({
  SmsService: vi.fn().mockImplementation(() => ({ sendOtp: vi.fn() })),
}));

vi.mock('@/server/services/user', () => ({
  UserService: vi.fn().mockImplementation(() => ({ initUser: vi.fn() })),
}));

describe('AICO-102 authentication security controls', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    mocks.betterAuth.mockClear();
    process.env = { ...originalEnv, NODE_ENV: 'test' };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('configures OTP expiry, attempts, password reset revoke, and auth rate limits', async () => {
    const { defineConfig } = await import('./define-config');
    const { emailOTP, phoneNumber } = await import('better-auth/plugins');

    defineConfig({ plugins: [] });

    expect(mocks.betterAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        emailAndPassword: expect.objectContaining({
          maxPasswordLength: 64,
          minPasswordLength: 8,
          revokeSessionsOnPasswordReset: true,
        }),
        rateLimit: expect.objectContaining({
          customRules: expect.objectContaining({
            '/phone-number/send-otp': { max: 3, window: 60 },
            '/phone-number/verify': { max: 10, window: 60 },
            '/request-password-reset': { max: 3, window: 60 },
          }),
        }),
        session: expect.objectContaining({
          cookieCache: expect.objectContaining({
            enabled: true,
            maxAge: 120,
          }),
        }),
      }),
    );

    expect(emailOTP).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedAttempts: 3,
        expiresIn: 300,
        otpLength: 6,
      }),
    );
    expect(phoneNumber).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedAttempts: 3,
        expiresIn: 300,
        otpLength: 6,
      }),
    );
  });

  it('blocks open redirects used in OAuth / auth callback paths', () => {
    expect(isSafeRedirectPath('https://evil.com')).toBe(false);
    expect(isSafeRedirectPath('//evil.com')).toBe(false);
    expect(sanitizeRedirectPath('https://evil.com', '/')).toBe('/');
    expect(sanitizeRedirectPath('/chat', '/')).toBe('/chat');
  });
});
