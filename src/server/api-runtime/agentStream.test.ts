// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { GET as agentStreamGet } from '@/app/(backend)/api/agent/stream/route';
import honoApp from '@/server/hono';

const mockStreamEventManager = {
  getStreamHistory: vi.fn(),
  subscribeStreamEvents: vi.fn(),
};

vi.mock('@/server/modules/AgentRuntime', () => ({
  createStreamEventManager: vi.fn(() => mockStreamEventManager),
}));

const createMissingOperationRequest = (headers?: HeadersInit) =>
  new Request('https://example.com/api/agent/stream', {
    headers,
    method: 'GET',
  });

const expectMissingOperation = async (response: Response, runtime?: string) => {
  expect(response.status).toBe(400);
  if (runtime) {
    expect(response.headers.get('x-lobe-api-runtime')).toBe(runtime);
  }
  expect(await response.json()).toEqual({
    error: 'operationId parameter is required',
  });
};

describe('/api/agent/stream runtime parity', () => {
  it('keeps the Next.js route as the default path', async () => {
    const response = await agentStreamGet(createMissingOperationRequest());

    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('default');
    await expectMissingOperation(response, 'next');
  });

  it('returns the same response through the Hono gray-release path', async () => {
    const response = await agentStreamGet(
      createMissingOperationRequest({ 'x-lobe-api-runtime': 'hono' }),
    );

    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('request-header');
    await expectMissingOperation(response, 'hono');
  });

  it('can be served by the root Hono runtime app', async () => {
    const response = await honoApp.fetch(createMissingOperationRequest());

    await expectMissingOperation(response);
  });
});
