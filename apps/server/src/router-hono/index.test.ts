import { describe, expect, it, vi } from 'vitest';

import app from './index';

vi.mock('./trpc/async', () => ({
  default: { fetch: () => new Response('async') },
}));
vi.mock('./trpc/lambda', () => ({
  default: { fetch: () => new Response('lambda') },
}));
vi.mock('./trpc/mobile', () => ({
  default: { fetch: () => new Response('mobile') },
}));
vi.mock('./trpc/tools', () => ({
  default: { fetch: () => new Response('tools') },
}));

describe('standalone Hono routes', () => {
  it.each([
    ['/trpc/async/healthcheck', 'async'],
    ['/trpc/lambda/healthcheck', 'lambda'],
    ['/trpc/mobile/healthcheck', 'mobile'],
    ['/trpc/tools/healthcheck', 'tools'],
  ])('forwards %s to its tRPC app', async (path, expected) => {
    const response = await app.request(path);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(expected);
  });
});
