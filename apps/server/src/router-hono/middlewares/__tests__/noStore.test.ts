// @vitest-environment node
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { noStore } from '../noStore';

describe('noStore', () => {
  it('adds Cache-Control: no-store to responses without a cache policy', async () => {
    const app = new Hono().use('*', noStore()).get('/data', (c) => c.json({ ok: true }));

    const res = await app.request('/data');

    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toEqual({ ok: true });
  });

  it('does not override an explicit cache policy from a handler', async () => {
    const app = new Hono()
      .use('*', noStore())
      .get('/public', (c) =>
        c.json({ ok: true }, 200, { 'Cache-Control': 'public, max-age=3600' }),
      );

    const res = await app.request('/public');

    expect(res.headers.get('Cache-Control')).toBe('public, max-age=3600');
  });

  it('preserves status and other headers', async () => {
    const app = new Hono()
      .use('*', noStore())
      .get('/redirect', (c) => c.json(null, 307, { Location: '/target' }));

    const res = await app.request('/redirect');

    expect(res.status).toBe(307);
    expect(res.headers.get('Location')).toBe('/target');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
});
