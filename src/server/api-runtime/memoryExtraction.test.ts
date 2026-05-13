// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { POST as memoryExtractionBenchmarkLoCoMoPost } from '@/app/(backend)/api/webhooks/memory-extraction/benchmark-locomo/route';
import { POST as memoryExtractionPost } from '@/app/(backend)/api/webhooks/memory-extraction/route';
import { POST as memoryUserPersonaUpdateWritingPost } from '@/app/(backend)/api/webhooks/memory-user-memory/persona/update-writing/route';
import { POST as memoryExtractChatTopicCancelPost } from '@/app/(backend)/api/webhooks/memory-user-memory/pipelines/extract/chat-topic/cancel/route';
import honoApp from '@/server/hono';

const createInvalidDateRequest = (headers?: HeadersInit) =>
  new Request('https://example.com/api/webhooks/memory-extraction', {
    body: JSON.stringify({
      fromDate: '2024-02-02T00:00:00.000Z',
      toDate: '2024-01-01T00:00:00.000Z',
    }),
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    method: 'POST',
  });

const createInvalidBenchmarkLoCoMoRequest = (headers?: HeadersInit) =>
  new Request('https://example.com/api/webhooks/memory-extraction/benchmark-locomo', {
    body: JSON.stringify({ sampleId: 'sample-a' }),
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    method: 'POST',
  });

const createMissingPersonaUserRequest = (headers?: HeadersInit) =>
  new Request('https://example.com/api/webhooks/memory-user-memory/persona/update-writing', {
    body: JSON.stringify({ mode: 'workflow' }),
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    method: 'POST',
  });

const createInvalidCancelRequest = (headers?: HeadersInit) =>
  new Request(
    'https://example.com/api/webhooks/memory-user-memory/pipelines/extract/chat-topic/cancel',
    {
      body: JSON.stringify({ reason: 'stop' }),
      headers: {
        'content-type': 'application/json',
        ...headers,
      },
      method: 'POST',
    },
  );

const expectInvalidDateResponse = async (response: Response, runtime?: string) => {
  expect(response.status).toBe(400);
  if (runtime) {
    expect(response.headers.get('x-lobe-api-runtime')).toBe(runtime);
  }
  expect(await response.json()).toEqual({
    error: '`fromDate` cannot be later than `toDate`',
  });
};

const expectInvalidBenchmarkLoCoMoResponse = async (response: Response, runtime?: string) => {
  expect(response.status).toBe(500);
  if (runtime) {
    expect(response.headers.get('x-lobe-api-runtime')).toBe(runtime);
  }
  const body = await response.json();
  expect(body.error).toContain('userId');
};

const expectMissingPersonaUserResponse = async (response: Response, runtime?: string) => {
  expect(response.status).toBe(400);
  if (runtime) {
    expect(response.headers.get('x-lobe-api-runtime')).toBe(runtime);
  }
  expect(await response.json()).toEqual({
    error: 'userId or userIds is required',
  });
};

const expectInvalidCancelResponse = async (response: Response, runtime?: string) => {
  expect(response.status).toBe(500);
  if (runtime) {
    expect(response.headers.get('x-lobe-api-runtime')).toBe(runtime);
  }
  const body = await response.json();
  expect(body.error).toContain('taskId');
};

describe('/api/webhooks/memory-extraction runtime parity', () => {
  it('keeps the Next.js route as the default path', async () => {
    const response = await memoryExtractionPost(createInvalidDateRequest());

    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('default');
    await expectInvalidDateResponse(response, 'next');
  });

  it('returns the same response through the Hono gray-release path', async () => {
    const response = await memoryExtractionPost(
      createInvalidDateRequest({ 'x-lobe-api-runtime': 'hono' }),
    );

    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('request-header');
    await expectInvalidDateResponse(response, 'hono');
  });

  it('can be served by the root Hono runtime app', async () => {
    const response = await honoApp.fetch(createInvalidDateRequest());

    await expectInvalidDateResponse(response);
  });
});

describe('/api/webhooks/memory-extraction/benchmark-locomo runtime parity', () => {
  it('keeps the Next.js route as the default path', async () => {
    const response = await memoryExtractionBenchmarkLoCoMoPost(
      createInvalidBenchmarkLoCoMoRequest(),
    );

    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('default');
    await expectInvalidBenchmarkLoCoMoResponse(response, 'next');
  });

  it('returns the same response through the Hono gray-release path', async () => {
    const response = await memoryExtractionBenchmarkLoCoMoPost(
      createInvalidBenchmarkLoCoMoRequest({ 'x-lobe-api-runtime': 'hono' }),
    );

    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('request-header');
    await expectInvalidBenchmarkLoCoMoResponse(response, 'hono');
  });

  it('can be served by the root Hono runtime app', async () => {
    const response = await honoApp.fetch(createInvalidBenchmarkLoCoMoRequest());

    await expectInvalidBenchmarkLoCoMoResponse(response);
  });
});

describe('/api/webhooks/memory-user-memory/persona/update-writing runtime parity', () => {
  it('keeps the Next.js route as the default path', async () => {
    const response = await memoryUserPersonaUpdateWritingPost(createMissingPersonaUserRequest());

    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('default');
    await expectMissingPersonaUserResponse(response, 'next');
  });

  it('returns the same response through the Hono gray-release path', async () => {
    const response = await memoryUserPersonaUpdateWritingPost(
      createMissingPersonaUserRequest({ 'x-lobe-api-runtime': 'hono' }),
    );

    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('request-header');
    await expectMissingPersonaUserResponse(response, 'hono');
  });

  it('can be served by the root Hono runtime app', async () => {
    const response = await honoApp.fetch(createMissingPersonaUserRequest());

    await expectMissingPersonaUserResponse(response);
  });
});

describe('/api/webhooks/memory-user-memory/pipelines/extract/chat-topic/cancel runtime parity', () => {
  it('keeps the Next.js route as the default path', async () => {
    const response = await memoryExtractChatTopicCancelPost(createInvalidCancelRequest());

    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('default');
    await expectInvalidCancelResponse(response, 'next');
  });

  it('returns the same response through the Hono gray-release path', async () => {
    const response = await memoryExtractChatTopicCancelPost(
      createInvalidCancelRequest({ 'x-lobe-api-runtime': 'hono' }),
    );

    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('request-header');
    await expectInvalidCancelResponse(response, 'hono');
  });

  it('can be served by the root Hono runtime app', async () => {
    const response = await honoApp.fetch(createInvalidCancelRequest());

    await expectInvalidCancelResponse(response);
  });
});
