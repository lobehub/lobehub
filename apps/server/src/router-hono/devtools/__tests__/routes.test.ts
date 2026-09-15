import { describe, expect, it, vi } from 'vitest';

import app from '../index';

vi.mock('../handlers/agentTracing', () => ({ agentTracing: vi.fn() }));
vi.mock('../handlers/testPush', () => ({ testPush: vi.fn() }));
vi.mock('../handlers/memoryUserMemoryBenchmarkLocomo', () => ({
  memoryUserMemoryBenchmarkLocomo: vi.fn(),
}));

describe('devtools hono routes', () => {
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
