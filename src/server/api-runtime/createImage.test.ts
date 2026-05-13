// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST as comfyUICreateImagePost } from '@/app/(backend)/webapi/create-image/comfyui/route';
import { auth } from '@/auth';
import honoApp from '@/server/hono';

vi.mock('@/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(async () => ({})),
}));

vi.mock('@/libs/trpc/lambda', () => ({
  createCallerFactory: vi.fn(),
}));

vi.mock('@/server/routers/lambda', () => ({
  lambdaRouter: {},
}));

const createComfyUIRequest = (headers?: HeadersInit) =>
  new Request('https://example.com/webapi/create-image/comfyui', {
    body: JSON.stringify({ model: 'test-model', params: {} }),
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    method: 'POST',
  });

const expectUnauthorized = async (response: Response, runtime?: string) => {
  expect(response.status).toBe(401);
  if (runtime) {
    expect(response.headers.get('x-lobe-api-runtime')).toBe(runtime);
  }
  const body = await response.json();
  expect(body.errorType).toBe(401);
  expect(body.body.provider).toBe('comfyui');
};

beforeEach(() => {
  vi.mocked(auth.api.getSession).mockResolvedValue(null);
});

describe('/webapi/create-image/comfyui runtime parity', () => {
  it('keeps the Next.js route as the default path', async () => {
    const response = await comfyUICreateImagePost(createComfyUIRequest());

    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('default');
    await expectUnauthorized(response, 'next');
  });

  it('returns the same response through the Hono gray-release path', async () => {
    const response = await comfyUICreateImagePost(
      createComfyUIRequest({ 'x-lobe-api-runtime': 'hono' }),
    );

    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('request-header');
    await expectUnauthorized(response, 'hono');
  });

  it('can be served by the root Hono runtime app', async () => {
    const response = await honoApp.fetch(createComfyUIRequest());

    await expectUnauthorized(response);
  });
});
