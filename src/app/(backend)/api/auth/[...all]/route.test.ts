// @vitest-environment node
import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET, POST } from './route';

type RouteHandler = (request: Request) => Promise<Response>;

const mocks = vi.hoisted(() => ({
  get: vi.fn<RouteHandler>(async () => Response.json({ ok: true })),
  post: vi.fn<RouteHandler>(async () => Response.json({ ok: true })),
}));

vi.mock('better-auth/next-js', () => ({
  toNextJsHandler: vi.fn(() => ({
    GET: mocks.get,
    POST: mocks.post,
  })),
}));

vi.mock('@/auth', () => ({
  auth: {},
}));

const createPostRequest = (body: string, contentType = 'application/json') =>
  new Request('https://localhost/api/auth/sign-in/email', {
    body,
    headers: { 'Content-Type': contentType },
    method: 'POST',
  }) as NextRequest;

describe('/api/auth/[...all] route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.get.mockResolvedValue(Response.json({ ok: true }));
    mocks.post.mockResolvedValue(Response.json({ ok: true }));
  });

  it('returns 400 for malformed JSON auth requests before Better Auth handles them', async () => {
    const response = await POST(
      createPostRequest('{"email":"user@example.com","password":"secret",}'),
    );

    await expect(response.json()).resolves.toEqual({
      code: 'INVALID_JSON',
      message: 'Malformed JSON request body',
    });
    expect(response.status).toBe(400);
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('passes valid JSON auth requests through without consuming the original body', async () => {
    mocks.post.mockImplementationOnce(async (request: Request) =>
      Response.json(await request.json()),
    );

    const response = await POST(
      createPostRequest(JSON.stringify({ email: 'user@example.com', password: 'secret' })),
    );

    await expect(response.json()).resolves.toEqual({
      email: 'user@example.com',
      password: 'secret',
    });
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });

  it('delegates non-JSON auth requests to Better Auth', async () => {
    const response = await POST(
      createPostRequest(
        'email=user%40example.com&password=secret',
        'application/x-www-form-urlencoded',
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });

  it('delegates GET requests to Better Auth', async () => {
    const request = new Request('https://localhost/api/auth/get-session') as NextRequest;

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(mocks.get).toHaveBeenCalledWith(request);
  });
});
