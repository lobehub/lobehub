// @vitest-environment node
import { TraceEventType } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { POST as tracePost } from '@/app/(backend)/webapi/trace/route';
import honoApp from '@/server/hono';

const { afterMock } = vi.hoisted(() => ({
  afterMock: vi.fn(),
}));

vi.mock('next/server', () => ({
  after: afterMock,
}));

const createTraceRequest = (headers?: HeadersInit) =>
  new Request('https://example.com/webapi/trace', {
    body: JSON.stringify({
      eventType: TraceEventType.CopyMessage,
      traceId: 'trace-id',
    }),
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    method: 'POST',
  });

const expectTraceAccepted = async (response: Response, runtime?: string) => {
  expect(response.status).toBe(201);
  if (runtime) {
    expect(response.headers.get('x-lobe-api-runtime')).toBe(runtime);
  }
  expect(await response.text()).toBe('');
};

describe('/webapi/trace runtime parity', () => {
  it('keeps the Next.js route as the default path', async () => {
    const response = await tracePost(createTraceRequest());

    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('default');
    expect(afterMock).toHaveBeenCalledTimes(1);
    await expectTraceAccepted(response, 'next');
  });

  it('returns the same response through the Hono gray-release path', async () => {
    const response = await tracePost(createTraceRequest({ 'x-lobe-api-runtime': 'hono' }));

    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('request-header');
    await expectTraceAccepted(response, 'hono');
  });

  it('can be served by the root Hono runtime app', async () => {
    const response = await honoApp.fetch(createTraceRequest());

    await expectTraceAccepted(response);
  });
});
