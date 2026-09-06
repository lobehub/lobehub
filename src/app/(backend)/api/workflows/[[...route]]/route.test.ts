// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));

vi.mock('@/server/router-hono/workflows', () => ({ default: { fetch: mocks.fetch } }));

const { GET } = await import('./route');

describe('workflow route shell', () => {
  it('forwards GET requests from Vercel Cron to the workflow router', async () => {
    const request = new Request('https://example.com/api/workflows/trash/purge');
    const response = new Response('ok');
    mocks.fetch.mockResolvedValue(response);

    await expect(GET(request)).resolves.toBe(response);
    expect(mocks.fetch).toHaveBeenCalledWith(request);
  });
});
