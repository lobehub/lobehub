import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { noStoreMiddleware } from './no-store';

const createApp = () => {
  const app = new Hono();
  app.use('*', noStoreMiddleware);
  app.get('/data', (c) => c.json({ ok: true }));
  app.get('/public', (c) => c.json({ ok: true }, 200, { 'Cache-Control': 'public, max-age=3600' }));
  return app;
};

describe('noStoreMiddleware', () => {
  it('adds Cache-Control: no-store to responses without a cache policy', async () => {
    const response = await createApp().request('/data');

    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({ ok: true });
  });

  it('does not override an explicit cache policy from a handler', async () => {
    const response = await createApp().request('/public');

    expect(response.headers.get('Cache-Control')).toBe('public, max-age=3600');
  });
});
