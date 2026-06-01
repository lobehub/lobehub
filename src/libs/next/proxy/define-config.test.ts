// @vitest-environment node
import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { defineConfig } from './define-config';

const appEnvMock = vi.hoisted(() => ({
  APP_URL: 'https://base.example.com',
  MIDDLEWARE_REWRITE_THROUGH_LOCAL: false,
}));

const authMock = vi.hoisted(() => ({
  getSession: vi.fn(),
}));

vi.mock('@/auth', () => ({
  auth: {
    api: {
      getSession: authMock.getSession,
    },
  },
}));

vi.mock('@/envs/app', () => ({
  appEnv: appEnvMock,
}));

vi.mock('@/envs/auth', () => ({
  authEnv: {
    ENABLE_OIDC: true,
  },
}));

vi.mock('@/utils/locale', () => ({
  parseBrowserLanguage: vi.fn(() => 'en-US'),
}));

vi.mock('@/utils/server/routeVariants', () => ({
  RouteVariants: {
    serializeVariants: vi.fn(() => 'desktop'),
  },
}));

const createRequest = (url: string): NextRequest => {
  const nextUrl = new URL(url);

  return {
    cookies: {
      get: vi.fn(() => undefined),
    },
    headers: new Headers({
      host: nextUrl.host,
    }),
    method: 'GET',
    nextUrl,
    url,
  } as unknown as NextRequest;
};

describe('defineConfig middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appEnvMock.APP_URL = 'https://base.example.com';
    appEnvMock.MIDDLEWARE_REWRITE_THROUGH_LOCAL = false;
    authMock.getSession.mockResolvedValue(null);
  });

  it('redirects requests from other hosts to the canonical app URL before auth', async () => {
    const { middleware } = defineConfig();

    const response = await middleware(
      createRequest('https://other.example.com/settings?tab=profile'),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://base.example.com/settings?tab=profile');
    expect(authMock.getSession).not.toHaveBeenCalled();
  });

  it('allows canonical-host protected requests when the user is signed in', async () => {
    authMock.getSession.mockResolvedValue({ user: { id: 'user_1' } });
    const { middleware } = defineConfig();

    const response = await middleware(
      createRequest('https://base.example.com/settings?tab=profile'),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
    expect(authMock.getSession).toHaveBeenCalledTimes(1);
  });

  it('redirects canonical-host protected requests to sign-in when the user is signed out', async () => {
    const { middleware } = defineConfig();

    const response = await middleware(
      createRequest('https://base.example.com/settings?tab=profile'),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(
      'https://base.example.com/signin?callbackUrl=https%3A%2F%2Fbase.example.com%2Fsettings%3Ftab%3Dprofile',
    );
    expect(authMock.getSession).toHaveBeenCalledTimes(1);
  });
});
