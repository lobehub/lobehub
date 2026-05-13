// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { GET } from '@/app/(backend)/api/v1/[[...route]]/route';
import apiApp from '@/server/api-hono';
import honoApp from '@/server/hono';

vi.mock('@lobechat/openapi', () => ({
  default: {
    fetch: (request: Request) => {
      const url = new URL(request.url);

      return Response.json({
        method: request.method,
        pathname: url.pathname,
        service: 'lobe-chat-api',
        status: 'ok',
      });
    },
  },
}));

const createHealthRequest = (headers?: HeadersInit) =>
  new Request('https://example.com/api/v1/health', { headers });

const expectOpenAPIHealthResponse = async (response: Response) => {
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    method: 'GET',
    pathname: '/api/v1/health',
    service: 'lobe-chat-api',
    status: 'ok',
  });
};

describe('/api/v1 runtime parity', () => {
  it('keeps the Next.js route as the default path', async () => {
    const response = await GET(createHealthRequest());

    expect(response.headers.get('x-lobe-api-runtime')).toBe('next');
    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('default');
    await expectOpenAPIHealthResponse(response);
  });

  it('returns the same response through the Hono gray-release path', async () => {
    const response = await GET(createHealthRequest({ 'x-lobe-api-runtime': 'hono' }));

    expect(response.headers.get('x-lobe-api-runtime')).toBe('hono');
    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('request-header');
    await expectOpenAPIHealthResponse(response);
  });

  it('can be served by the standalone API Hono app', async () => {
    const response = await apiApp.fetch(createHealthRequest());

    await expectOpenAPIHealthResponse(response);
  });

  it('can be served by the root Hono runtime app', async () => {
    const response = await honoApp.fetch(createHealthRequest());

    await expectOpenAPIHealthResponse(response);
  });
});
