// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

describe('Next Hono binding route', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('forwards the rewritten request path into the configured Hono dev runtime', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('LOBE_DEV_HONO_TARGET', 'http://localhost:3011');
    const fetchSpy = vi.fn(async (request: Request) => {
      expect(request.url).toBe('http://localhost:3011/api/version');

      return Response.json({ version: '2.1.56' });
    });
    vi.stubGlobal('fetch', fetchSpy);

    const response = await GET(new Request('http://localhost:3010/hono-runtime/api/version'));

    expect(response.status).toBe(200);
    expect(response.headers.get('x-lobe-dev-hono-binding')).toBe('next-catch-all');
    await expect(response.json()).resolves.toEqual({ version: '2.1.56' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
