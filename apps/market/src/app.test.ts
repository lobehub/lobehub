import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMarketApp } from './app';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createMarketApp', () => {
  it('returns the internal Market health payload', async () => {
    const app = createMarketApp();

    const response = await app.request('/health');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      service: 'lobehub-internal-market',
      status: 'ok',
    });
  });

  it('returns not implemented for scaffolded Market endpoints', async () => {
    const app = createMarketApp();

    const response = await app.request('/lobehub-oidc/auth');

    expect(response.status).toBe(501);
    expect(await response.json()).toEqual({
      error: {
        code: 'not_implemented',
        message: '/lobehub-oidc/auth is not implemented in the internal Market v1 service.',
      },
    });
  });

  it('returns a JSON error for unknown Market endpoints', async () => {
    const app = createMarketApp();

    const response = await app.request('/unknown');

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: {
        code: 'not_found',
        message: 'Requested Market endpoint was not found.',
      },
    });
  });

  it('proxies unimplemented v1 API routes to the upstream Market service', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ items: [] }), {
        headers: { 'content-type': 'application/json' },
      }),
    );
    const app = createMarketApp({
      env: {
        MARKET_TRUSTED_CLIENT_ID: 'internal-lobehub',
        MARKET_TRUSTED_CLIENT_SECRET: 'lobehub-market_tcs_test-secret',
        MARKET_UPSTREAM_BASE_URL: 'https://market.example.com',
      },
    });
    const request = new Request('http://market:3211/api/v1/skills?locale=en-US', {
      headers: {
        'authorization': 'Bearer user-token',
        'host': 'market:3211',
        'x-lobe-trust-token': 'trusted-token',
        'x-request-id': 'request-1',
      },
    });

    const response = await app.request(request);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [] });
    expect(fetchSpy).toHaveBeenCalledWith('https://market.example.com/api/v1/skills?locale=en-US', {
      headers: expect.any(Headers),
      method: 'GET',
    });

    const headers = fetchSpy.mock.calls[0]?.[1]?.headers;
    if (!(headers instanceof Headers)) throw new TypeError('Expected headers to be Headers');

    expect(headers.get('authorization')).toBe('Bearer user-token');
    expect(headers.get('x-request-id')).toBe('request-1');
    expect(headers.has('host')).toBe(false);
    expect(headers.has('x-lobe-trust-token')).toBe(false);
  });
});
