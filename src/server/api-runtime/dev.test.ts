// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GET as agentTracingGet } from '@/app/(backend)/api/dev/agent-tracing/route';
import { POST as memoryUserMemoryBenchmarkLoCoMoPost } from '@/app/(backend)/api/dev/memory-user-memory/benchmark-locomo/route';
import honoApp from '@/server/hono';

const createAgentTracingRequest = (headers?: HeadersInit, search = '') =>
  new Request(`https://example.com/api/dev/agent-tracing${search}`, { headers });

const createMemoryUserMemoryBenchmarkLoCoMoRequest = (headers?: HeadersInit) =>
  new Request('https://example.com/api/dev/memory-user-memory/benchmark-locomo', {
    body: JSON.stringify({ query: 'memory' }),
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    method: 'POST',
  });

const expectDevOnly = async (response: Response, runtime?: string) => {
  expect(response.status).toBe(404);
  if (runtime) {
    expect(response.headers.get('x-lobe-api-runtime')).toBe(runtime);
  }
  expect(await response.json()).toEqual({ error: 'dev only' });
};

const expectMissingTraceFile = async (response: Response, runtime?: string) => {
  expect(response.status).toBe(404);
  if (runtime) {
    expect(response.headers.get('x-lobe-api-runtime')).toBe(runtime);
  }
  expect(await response.json()).toEqual({ error: 'not found' });
};

const expectBenchmarkDisabled = async (response: Response, runtime?: string) => {
  expect(response.status).toBe(404);
  if (runtime) {
    expect(response.headers.get('x-lobe-api-runtime')).toBe(runtime);
  }
  expect(await response.json()).toEqual({ error: 'Not found' });
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('/api/dev/agent-tracing runtime parity', () => {
  it('keeps the Next.js route as the default path outside development', async () => {
    vi.stubEnv('NODE_ENV', 'test');

    const response = await agentTracingGet(createAgentTracingRequest());

    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('default');
    await expectDevOnly(response, 'next');
  });

  it('returns the same non-development response through the Hono gray-release path', async () => {
    vi.stubEnv('NODE_ENV', 'test');

    const response = await agentTracingGet(
      createAgentTracingRequest({ 'x-lobe-api-runtime': 'hono' }),
    );

    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('request-header');
    await expectDevOnly(response, 'hono');
  });

  it('can be served by the root Hono runtime app outside development', async () => {
    vi.stubEnv('NODE_ENV', 'test');

    const response = await honoApp.fetch(createAgentTracingRequest());

    await expectDevOnly(response);
  });

  it('preserves development missing-file semantics across Next and Hono', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const search = '?file=definitely-missing-agent-trace.json';

    const nextResponse = await agentTracingGet(createAgentTracingRequest(undefined, search));
    const honoResponse = await agentTracingGet(
      createAgentTracingRequest({ 'x-lobe-api-runtime': 'hono' }, search),
    );
    const rootHonoResponse = await honoApp.fetch(createAgentTracingRequest(undefined, search));

    await expectMissingTraceFile(nextResponse, 'next');
    await expectMissingTraceFile(honoResponse, 'hono');
    await expectMissingTraceFile(rootHonoResponse);
  });
});

describe('/api/dev/memory-user-memory/benchmark-locomo runtime parity', () => {
  it('keeps the Next.js route as the default path when the benchmark flag is disabled', async () => {
    vi.stubEnv('MEMORY_USER_MEMORY_FEATURE_FLAG_BENCHMARK_LOCOMO', 'false');

    const response = await memoryUserMemoryBenchmarkLoCoMoPost(
      createMemoryUserMemoryBenchmarkLoCoMoRequest(),
    );

    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('default');
    await expectBenchmarkDisabled(response, 'next');
  });

  it('returns the same disabled-flag response through the Hono gray-release path', async () => {
    vi.stubEnv('MEMORY_USER_MEMORY_FEATURE_FLAG_BENCHMARK_LOCOMO', 'false');

    const response = await memoryUserMemoryBenchmarkLoCoMoPost(
      createMemoryUserMemoryBenchmarkLoCoMoRequest({ 'x-lobe-api-runtime': 'hono' }),
    );

    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('request-header');
    await expectBenchmarkDisabled(response, 'hono');
  });

  it('can be served by the root Hono runtime app when the benchmark flag is disabled', async () => {
    vi.stubEnv('MEMORY_USER_MEMORY_FEATURE_FLAG_BENCHMARK_LOCOMO', 'false');

    const response = await honoApp.fetch(createMemoryUserMemoryBenchmarkLoCoMoRequest());

    await expectBenchmarkDisabled(response);
  });
});
