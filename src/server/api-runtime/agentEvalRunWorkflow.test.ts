// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { POST as onThreadCompletePost } from '@/app/(backend)/api/workflows/agent-eval-run/on-thread-complete/route';
import { POST as onTrajectoryCompletePost } from '@/app/(backend)/api/workflows/agent-eval-run/on-trajectory-complete/route';
import honoApp from '@/server/hono';

const createOnThreadCompleteRequest = (headers?: HeadersInit) =>
  new Request('https://example.com/api/workflows/agent-eval-run/on-thread-complete', {
    body: JSON.stringify({ runId: 'run-1' }),
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    method: 'POST',
  });

const createOnTrajectoryCompleteRequest = (headers?: HeadersInit) =>
  new Request('https://example.com/api/workflows/agent-eval-run/on-trajectory-complete', {
    body: JSON.stringify({ runId: 'run-1' }),
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    method: 'POST',
  });

const expectMissingFields = async (response: Response, runtime?: string) => {
  expect(response.status).toBe(400);
  if (runtime) {
    expect(response.headers.get('x-lobe-api-runtime')).toBe(runtime);
  }
  expect(await response.json()).toEqual({ error: 'Missing required fields' });
};

describe('/api/workflows/agent-eval-run/on-thread-complete runtime parity', () => {
  it('keeps the Next.js route as the default path', async () => {
    const response = await onThreadCompletePost(createOnThreadCompleteRequest());

    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('default');
    await expectMissingFields(response, 'next');
  });

  it('returns the same response through the Hono gray-release path', async () => {
    const response = await onThreadCompletePost(
      createOnThreadCompleteRequest({ 'x-lobe-api-runtime': 'hono' }),
    );

    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('request-header');
    await expectMissingFields(response, 'hono');
  });

  it('can be served by the root Hono runtime app', async () => {
    const response = await honoApp.fetch(createOnThreadCompleteRequest());

    await expectMissingFields(response);
  });
});

describe('/api/workflows/agent-eval-run/on-trajectory-complete runtime parity', () => {
  it('keeps the Next.js route as the default path', async () => {
    const response = await onTrajectoryCompletePost(createOnTrajectoryCompleteRequest());

    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('default');
    await expectMissingFields(response, 'next');
  });

  it('returns the same response through the Hono gray-release path', async () => {
    const response = await onTrajectoryCompletePost(
      createOnTrajectoryCompleteRequest({ 'x-lobe-api-runtime': 'hono' }),
    );

    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('request-header');
    await expectMissingFields(response, 'hono');
  });

  it('can be served by the root Hono runtime app', async () => {
    const response = await honoApp.fetch(createOnTrajectoryCompleteRequest());

    await expectMissingFields(response);
  });
});
