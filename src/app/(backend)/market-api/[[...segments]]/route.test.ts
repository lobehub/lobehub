// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET, POST } from './route';

const originalMarketBaseUrl = process.env.MARKET_BASE_URL;

beforeEach(() => {
  process.env.MARKET_BASE_URL = 'http://market:3211';
});

afterEach(() => {
  process.env.MARKET_BASE_URL = originalMarketBaseUrl;
  vi.restoreAllMocks();
});

describe('market-api proxy route', () => {
  it('proxies GET requests to the configured Market base URL', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('zip-bytes', {
        headers: { 'content-type': 'application/zip' },
        status: 200,
      }),
    );

    const response = await GET(
      new Request('https://lobehub.example.com/market-api/api/v1/skills/demo/download'),
      {
        params: Promise.resolve({ segments: ['api', 'v1', 'skills', 'demo', 'download'] }),
      },
    );

    expect(fetchSpy).toHaveBeenCalledWith('http://market:3211/api/v1/skills/demo/download', {
      headers: expect.any(Headers),
      method: 'GET',
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('zip-bytes');
  });

  it('preserves query strings and forwards bodies for POST requests', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('created'));
    const request = new Request(
      'https://lobehub.example.com/market-api/api/v1/skills?source=lobe',
      {
        body: JSON.stringify({ name: 'demo' }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      },
    );

    await POST(request, {
      params: Promise.resolve({ segments: ['api', 'v1', 'skills'] }),
    });

    expect(fetchSpy).toHaveBeenCalledWith('http://market:3211/api/v1/skills?source=lobe', {
      body: request.body,
      duplex: 'half',
      headers: expect.any(Headers),
      method: 'POST',
    });
  });

  it('encodes decoded route segments without splitting reserved segment data', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'));

    await GET(new Request('https://lobehub.example.com/market-api/skills/hello%20world/a%2Fb'), {
      params: Promise.resolve({ segments: ['skills', 'hello world', 'a/b'] }),
    });

    expect(fetchSpy).toHaveBeenCalledWith('http://market:3211/skills/hello%20world/a%2Fb', {
      headers: expect.any(Headers),
      method: 'GET',
    });
  });

  it('copies safe request headers and removes host credentials before proxying', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'));

    await GET(
      new Request('https://lobehub.example.com/market-api/api/v1/skills', {
        headers: {
          'authorization': 'Bearer token',
          'cookie': 'session=secret',
          'host': 'lobehub.example.com',
          'x-request-id': 'request-1',
        },
      }),
      {
        params: Promise.resolve({ segments: ['api', 'v1', 'skills'] }),
      },
    );

    const headers = fetchSpy.mock.calls[0]?.[1]?.headers;

    if (!(headers instanceof Headers)) throw new TypeError('Expected headers to be Headers');

    expect(headers.has('authorization')).toBe(false);
    expect(headers.has('cookie')).toBe(false);
    expect(headers.get('x-request-id')).toBe('request-1');
    expect(headers.has('host')).toBe(false);
  });

  it('throws a clear error when MARKET_BASE_URL is missing', async () => {
    delete process.env.MARKET_BASE_URL;

    await expect(
      GET(new Request('https://lobehub.example.com/market-api/api/v1/skills'), {
        params: Promise.resolve({ segments: ['api', 'v1', 'skills'] }),
      }),
    ).rejects.toThrow('MARKET_BASE_URL is required to proxy Market API requests');
  });
});
