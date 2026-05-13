// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from '@/app/(backend)/webapi/chat/[provider]/route';
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

vi.mock('@/server/modules/ModelRuntime', () => ({
  createTraceOptions: vi.fn(() => ({})),
  initModelRuntimeFromDB: vi.fn(),
}));

const createRequest = (headers?: HeadersInit) =>
  new Request('https://example.com/webapi/chat/openai', {
    body: JSON.stringify({ model: 'test-model' }),
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    method: 'POST',
  });

const createSegmentData = () => ({ params: Promise.resolve({ provider: 'openai' }) });

const expectUnauthorized = async (response: Response, runtime?: string) => {
  expect(response.status).toBe(401);
  if (runtime) {
    expect(response.headers.get('x-lobe-api-runtime')).toBe(runtime);
  }
  const body = await response.json();
  expect(body.errorType).toBe(401);
  expect(body.body.provider).toBe('openai');
};

beforeEach(() => {
  vi.mocked(auth.api.getSession).mockResolvedValue(null);
});

describe('/webapi/chat/:provider runtime parity', () => {
  it('keeps the Next.js route as the default path', async () => {
    const response = await POST(createRequest(), createSegmentData());

    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('default');
    await expectUnauthorized(response, 'next');
  });

  it('returns the same response through the Hono gray-release path', async () => {
    const response = await POST(
      createRequest({ 'x-lobe-api-runtime': 'hono' }),
      createSegmentData(),
    );

    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('request-header');
    await expectUnauthorized(response, 'hono');
  });

  it('can be served by the root Hono runtime app', async () => {
    const response = await honoApp.fetch(createRequest());

    await expectUnauthorized(response);
  });
});
