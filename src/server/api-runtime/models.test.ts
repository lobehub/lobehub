// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST as pullModelsPost } from '@/app/(backend)/webapi/models/[provider]/pull/route';
import { GET as modelsGet } from '@/app/(backend)/webapi/models/[provider]/route';
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

const createModelsRequest = (headers?: HeadersInit) =>
  new Request('https://example.com/webapi/models/openai', { headers });

const createPullModelsRequest = (headers?: HeadersInit) =>
  new Request('https://example.com/webapi/models/openai/pull', {
    body: JSON.stringify({ model: 'llama3' }),
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

describe('/webapi/models/:provider runtime parity', () => {
  it('keeps the Next.js route as the default path', async () => {
    const response = await modelsGet(createModelsRequest(), createSegmentData());

    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('default');
    await expectUnauthorized(response, 'next');
  });

  it('returns the same response through the Hono gray-release path', async () => {
    const response = await modelsGet(
      createModelsRequest({ 'x-lobe-api-runtime': 'hono' }),
      createSegmentData(),
    );

    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('request-header');
    await expectUnauthorized(response, 'hono');
  });

  it('can be served by the root Hono runtime app', async () => {
    const response = await honoApp.fetch(createModelsRequest());

    await expectUnauthorized(response);
  });
});

describe('/webapi/models/:provider/pull runtime parity', () => {
  it('keeps the Next.js route as the default path', async () => {
    const response = await pullModelsPost(createPullModelsRequest(), createSegmentData());

    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('default');
    await expectUnauthorized(response, 'next');
  });

  it('returns the same response through the Hono gray-release path', async () => {
    const response = await pullModelsPost(
      createPullModelsRequest({ 'x-lobe-api-runtime': 'hono' }),
      createSegmentData(),
    );

    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('request-header');
    await expectUnauthorized(response, 'hono');
  });

  it('can be served by the root Hono runtime app', async () => {
    const response = await honoApp.fetch(createPullModelsRequest());

    await expectUnauthorized(response);
  });
});
