import { afterEach, describe, expect, it, vi } from 'vitest';

import { memoryUserMemoryBenchmarkLocomo } from '../handlers/memoryUserMemoryBenchmarkLocomo';
import app from '../index';

vi.mock('../handlers/agentTracing', () => ({ agentTracing: vi.fn() }));
vi.mock('../handlers/testPush', () => ({ testPush: vi.fn() }));
vi.mock('../handlers/memoryUserMemoryBenchmarkLocomo', () => ({
  memoryUserMemoryBenchmarkLocomo: vi.fn(() => new Response('benchmark executed')),
}));

describe('devtools hono routes', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('rejects the memory benchmark probe when authentication is unconfigured', async () => {
    vi.stubEnv('MEMORY_USER_MEMORY_WEBHOOK_HEADERS', undefined);
    vi.stubEnv('MEMORY_USER_MEMORY_FEATURE_FLAG_BENCHMARK_LOCOMO', 'true');

    const response = await app.request('/api/dev/memory-user-memory/benchmark-locomo', {
      method: 'POST',
    });

    expect(response.status).toBe(503);
    expect(memoryUserMemoryBenchmarkLocomo).not.toHaveBeenCalled();
  });

  it('keeps the /api/dev URLs the Next.js segments used to serve', () => {
    const paths = app.routes
      .filter((route) => route.method !== 'ALL')
      .map((route) => `${route.method} ${route.path}`);

    expect([...new Set(paths)].sort()).toEqual([
      'GET /api/dev/agent-tracing',
      'POST /api/dev/memory-user-memory/benchmark-locomo',
      'POST /api/dev/test-push',
    ]);
  });
});
