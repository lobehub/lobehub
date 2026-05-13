// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { GET as oidcProviderGet } from '@/app/(backend)/oidc/[...oidc]/route';
import { GET as oidcCallbackDesktopGet } from '@/app/(backend)/oidc/callback/desktop/route';
import { POST as oidcClearSessionPost } from '@/app/(backend)/oidc/clear-session/route';
import { POST as oidcConsentPost } from '@/app/(backend)/oidc/consent/route';
import { GET as oidcHandoffGet } from '@/app/(backend)/oidc/handoff/route';
import honoApp from '@/server/hono';

vi.mock('@/envs/auth', () => ({
  authEnv: {
    ENABLE_OIDC: false,
  },
}));
vi.mock('@/server/services/oidc', () => ({
  OIDCService: {
    initialize: vi.fn(async () => ({
      getInteractionDetails: vi.fn(async () => {
        throw new Error('interaction session not found');
      }),
    })),
  },
}));

const createHandoffRequest = (headers?: HeadersInit) =>
  new Request('https://example.com/oidc/handoff?id=handoff-id', { headers });
const createDesktopCallbackRequest = (headers?: HeadersInit) =>
  new Request('https://example.com/oidc/callback/desktop', { headers });
const createClearSessionRequest = (headers?: HeadersInit) =>
  new Request('https://example.com/oidc/clear-session', { headers, method: 'POST' });
const createConsentRequest = (headers?: HeadersInit) =>
  new Request('https://example.com/oidc/consent', {
    body: new URLSearchParams({ consent: 'accept', uid: 'expired-uid' }),
    headers,
    method: 'POST',
  });
const createProviderRequest = (headers?: HeadersInit) =>
  new Request('https://example.com/oidc/.well-known/openid-configuration', { headers });

const expectMissingParams = async (response: Response, runtime?: string) => {
  expect(response.status).toBe(400);
  if (runtime) {
    expect(response.headers.get('x-lobe-api-runtime')).toBe(runtime);
  }
  expect(await response.json()).toEqual({
    error: 'Missing required parameters: id and client',
  });
};

const expectInvalidDesktopCallbackRedirect = (response: Response, runtime?: string) => {
  expect(response.status).toBe(307);
  if (runtime) {
    expect(response.headers.get('x-lobe-api-runtime')).toBe(runtime);
  }
  const location = response.headers.get('location');
  expect(location).toBeTruthy();
  const redirectUrl = new URL(location!);
  expect(redirectUrl.pathname).toBe('/oauth/callback/error');
  expect(redirectUrl.searchParams.get('reason')).toBe('invalid_request');
};

const expectOIDCDisabled = async (response: Response, runtime?: string) => {
  expect(response.status).toBe(404);
  if (runtime) {
    expect(response.headers.get('x-lobe-api-runtime')).toBe(runtime);
  }
  expect(await response.text()).toBe('OIDC is not enabled');
};

const expectUnauthorizedClearSession = async (response: Response, runtime?: string) => {
  expect(response.status).toBe(401);
  if (runtime) {
    expect(response.headers.get('x-lobe-api-runtime')).toBe(runtime);
  }
  expect(await response.json()).toEqual({ error: 'unauthorized' });
};

const expectExpiredConsent = async (response: Response, runtime?: string) => {
  expect(response.status).toBe(400);
  if (runtime) {
    expect(response.headers.get('x-lobe-api-runtime')).toBe(runtime);
  }
  expect(await response.json()).toEqual({
    error: 'invalid_request',
    error_description:
      'Authorization session expired or invalid, please restart the authorization flow',
  });
};

describe('/oidc/[...oidc] runtime parity', () => {
  it('keeps the Next.js route as the default path when OIDC is disabled', async () => {
    const response = await oidcProviderGet(createProviderRequest());

    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('default');
    await expectOIDCDisabled(response, 'next');
  });

  it('returns the same disabled-provider response through the Hono gray-release path', async () => {
    const response = await oidcProviderGet(createProviderRequest({ 'x-lobe-api-runtime': 'hono' }));

    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('request-header');
    await expectOIDCDisabled(response, 'hono');
  });

  it('can be served by the root Hono runtime app', async () => {
    const response = await honoApp.fetch(createProviderRequest());

    await expectOIDCDisabled(response);
  });
});

describe('/oidc/consent runtime parity', () => {
  it('keeps the Next.js route as the default path', async () => {
    const response = await oidcConsentPost(createConsentRequest());

    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('default');
    await expectExpiredConsent(response, 'next');
  });

  it('returns the same expired-interaction response through the Hono gray-release path', async () => {
    const response = await oidcConsentPost(createConsentRequest({ 'x-lobe-api-runtime': 'hono' }));

    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('request-header');
    await expectExpiredConsent(response, 'hono');
  });

  it('can be served by the root Hono runtime app', async () => {
    const response = await honoApp.fetch(createConsentRequest());

    await expectExpiredConsent(response);
  });
});

describe('/oidc/clear-session runtime parity', () => {
  it('keeps the Next.js route as the default path', async () => {
    const response = await oidcClearSessionPost(createClearSessionRequest());

    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('default');
    await expectUnauthorizedClearSession(response, 'next');
  });

  it('returns the same unauthenticated response through the Hono gray-release path', async () => {
    const response = await oidcClearSessionPost(
      createClearSessionRequest({ 'x-lobe-api-runtime': 'hono' }),
    );

    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('request-header');
    await expectUnauthorizedClearSession(response, 'hono');
  });

  it('can be served by the root Hono runtime app', async () => {
    const response = await honoApp.fetch(createClearSessionRequest());

    await expectUnauthorizedClearSession(response);
  });
});

describe('/oidc/callback/desktop runtime parity', () => {
  it('keeps the Next.js route as the default path', async () => {
    const response = await oidcCallbackDesktopGet(createDesktopCallbackRequest());

    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('default');
    expectInvalidDesktopCallbackRedirect(response, 'next');
  });

  it('returns the same invalid-request redirect through the Hono gray-release path', async () => {
    const response = await oidcCallbackDesktopGet(
      createDesktopCallbackRequest({ 'x-lobe-api-runtime': 'hono' }),
    );

    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('request-header');
    expectInvalidDesktopCallbackRedirect(response, 'hono');
  });

  it('can be served by the root Hono runtime app', async () => {
    const response = await honoApp.fetch(createDesktopCallbackRequest());

    expectInvalidDesktopCallbackRedirect(response);
  });
});

describe('/oidc/handoff runtime parity', () => {
  it('keeps the Next.js route as the default path', async () => {
    const response = await oidcHandoffGet(createHandoffRequest());

    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('default');
    await expectMissingParams(response, 'next');
  });

  it('returns the same response through the Hono gray-release path', async () => {
    const response = await oidcHandoffGet(createHandoffRequest({ 'x-lobe-api-runtime': 'hono' }));

    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('request-header');
    await expectMissingParams(response, 'hono');
  });

  it('can be served by the root Hono runtime app', async () => {
    const response = await honoApp.fetch(createHandoffRequest());

    await expectMissingParams(response);
  });
});
