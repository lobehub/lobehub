// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { GET as betterAuthGet } from '@/app/(backend)/api/auth/[...all]/route';
import { POST as checkUserPost } from '@/app/(backend)/api/auth/check-user/route';
import { POST as resolveUsernamePost } from '@/app/(backend)/api/auth/resolve-username/route';
import apiApp from '@/server/api-hono';
import honoApp from '@/server/hono';

vi.mock('@/auth', () => ({
  auth: {
    handler: vi.fn((request: Request) =>
      Response.json(
        { method: request.method, path: new URL(request.url).pathname },
        { status: 404 },
      ),
    ),
  },
}));

const createJsonRequest = (path: string, body: Record<string, unknown>, headers?: HeadersInit) =>
  new Request(`https://example.com${path}`, {
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    method: 'POST',
  });

const expectJsonResponse = async (
  response: Response,
  expectedStatus: number,
  expectedBody: Record<string, unknown>,
) => {
  expect(response.status).toBe(expectedStatus);
  expect(await response.json()).toEqual(expectedBody);
};

const toComparableResponse = async (response: Response) => ({
  body: await response.text(),
  contentType: response.headers.get('content-type'),
  status: response.status,
});

describe('/api/auth/[...all] runtime parity', () => {
  it('keeps the Better Auth Next.js route as the default path', async () => {
    const response = await betterAuthGet(new Request('https://example.com/api/auth/unknown'));

    expect(response.headers.get('x-lobe-api-runtime')).toBe('next');
    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('default');
    expect(response.status).toBe(404);
  });

  it('returns the same Better Auth response through the Hono gray-release path', async () => {
    const nextResponse = await betterAuthGet(new Request('https://example.com/api/auth/unknown'));
    const honoResponse = await betterAuthGet(
      new Request('https://example.com/api/auth/unknown', {
        headers: { 'x-lobe-api-runtime': 'hono' },
      }),
    );

    expect(honoResponse.headers.get('x-lobe-api-runtime')).toBe('hono');
    expect(honoResponse.headers.get('x-lobe-api-runtime-reason')).toBe('request-header');
    expect(await toComparableResponse(honoResponse)).toEqual(
      await toComparableResponse(nextResponse),
    );
  });

  it('can be served by the standalone API Hono app', async () => {
    const nextResponse = await betterAuthGet(new Request('https://example.com/api/auth/unknown'));
    const apiResponse = await apiApp.fetch(new Request('https://example.com/api/auth/unknown'));

    expect(await toComparableResponse(apiResponse)).toEqual(
      await toComparableResponse(nextResponse),
    );
  });
});

describe('/api/auth/check-user runtime parity', () => {
  it('keeps the Next.js route as the default path', async () => {
    const response = await checkUserPost(createJsonRequest('/api/auth/check-user', {}));

    expect(response.headers.get('x-lobe-api-runtime')).toBe('next');
    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('default');
    await expectJsonResponse(response, 400, { error: 'Email is required', exists: false });
  });

  it('returns the same validation response through the Hono gray-release path', async () => {
    const response = await checkUserPost(
      createJsonRequest('/api/auth/check-user', {}, { 'x-lobe-api-runtime': 'hono' }),
    );

    expect(response.headers.get('x-lobe-api-runtime')).toBe('hono');
    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('request-header');
    await expectJsonResponse(response, 400, { error: 'Email is required', exists: false });
  });

  it('can be served by the standalone API Hono app', async () => {
    const response = await apiApp.fetch(createJsonRequest('/api/auth/check-user', {}));

    await expectJsonResponse(response, 400, { error: 'Email is required', exists: false });
  });
});

describe('/api/auth/resolve-username runtime parity', () => {
  it('keeps the Next.js route as the default path', async () => {
    const response = await resolveUsernamePost(
      createJsonRequest('/api/auth/resolve-username', { username: '   ' }),
    );

    expect(response.headers.get('x-lobe-api-runtime')).toBe('next');
    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('default');
    await expectJsonResponse(response, 400, { error: 'Username is required', exists: false });
  });

  it('returns the same validation response through the Hono gray-release path', async () => {
    const response = await resolveUsernamePost(
      createJsonRequest(
        '/api/auth/resolve-username',
        { username: '   ' },
        { 'x-lobe-api-runtime': 'hono' },
      ),
    );

    expect(response.headers.get('x-lobe-api-runtime')).toBe('hono');
    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('request-header');
    await expectJsonResponse(response, 400, { error: 'Username is required', exists: false });
  });

  it('can be served by the root Hono runtime app', async () => {
    const response = await honoApp.fetch(
      createJsonRequest('/api/auth/resolve-username', { username: '   ' }),
    );

    await expectJsonResponse(response, 400, { error: 'Username is required', exists: false });
  });
});
