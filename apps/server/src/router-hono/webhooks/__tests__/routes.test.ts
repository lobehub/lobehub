import { describe, expect, it, vi } from 'vitest';

import app from '../index';

/**
 * These endpoints used to be Next.js route segments, where the directory layout
 * *was* the URL. Now the paths are hand-written strings in the app index and a
 * typo silently 404s a provider callback instead of failing the build, so pin
 * the full mount table.
 *
 * Handlers are mocked out: importing them for real drags in model-runtime and
 * the db clients, which is far more than a routing assertion needs.
 */
vi.mock('../handlers/casdoor', () => ({ casdoorWebhook: vi.fn() }));
vi.mock('../handlers/github', () => ({ githubWebhook: vi.fn() }));
vi.mock('../handlers/githubInstall', () => ({ githubInstall: vi.fn() }));
vi.mock('../handlers/githubSetup', () => ({ githubSetup: vi.fn() }));
vi.mock('../handlers/logto', () => ({ logtoWebhook: vi.fn() }));
vi.mock('../handlers/memoryExtraction', () => ({ memoryExtractionWebhook: vi.fn() }));
vi.mock('../handlers/memoryExtractionBenchmarkLocomo', () => ({
  memoryExtractionBenchmarkLocomo: vi.fn(),
}));
vi.mock('../handlers/memoryUserMemoryChatTopicCancel', () => ({
  memoryUserMemoryChatTopicCancel: vi.fn(),
}));
vi.mock('../handlers/memoryUserMemoryPersonaUpdateWriting', () => ({
  memoryUserMemoryPersonaUpdateWriting: vi.fn(),
}));
vi.mock('../handlers/video', () => ({ videoWebhook: vi.fn() }));

describe('webhooks hono routes', () => {
  it('serves every migrated webhook at its original URL', () => {
    const paths = app.routes.filter((route) => route.method === 'POST').map((route) => route.path);

    expect([...new Set(paths)].sort()).toEqual([
      '/api/webhooks/casdoor',
      '/api/webhooks/github',
      '/api/webhooks/logto',
      '/api/webhooks/memory-extraction',
      '/api/webhooks/memory-extraction/benchmark-locomo',
      '/api/webhooks/memory-user-memory/persona/update-writing',
      '/api/webhooks/memory-user-memory/pipelines/extract/chat-topic/cancel',
      '/api/webhooks/video/:provider',
    ]);
  });

  it('serves the GitHub App install and setup redirects as GET', () => {
    const paths = app.routes.filter((route) => route.method === 'GET').map((route) => route.path);

    expect([...new Set(paths)].sort()).toEqual([
      '/api/webhooks/github/install',
      '/api/webhooks/github/oauth/callback',
      '/api/webhooks/github/setup',
    ]);
  });
});
