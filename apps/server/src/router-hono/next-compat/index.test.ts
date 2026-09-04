import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import { nextCompat, runWithRequestContext } from './context';
import { cookies, draftMode, headers } from './headers';
import { after } from './server';

const createApp = () => new Hono().use('*', nextCompat());

describe('next-compat headers()', () => {
  it('returns the current request headers inside a Hono handler', async () => {
    const app = createApp().get('/probe', async (c) =>
      c.text((await headers()).get('x-probe') ?? ''),
    );

    const response = await app.request('/probe', { headers: { 'x-probe': 'ok' } });

    expect(await response.text()).toBe('ok');
  });

  it('throws Next.js wording outside a request scope', async () => {
    await expect(headers()).rejects.toThrow('`headers` was called outside a request scope');
  });
});

describe('next-compat cookies()', () => {
  it('reads request cookies and turns set() into a Set-Cookie header', async () => {
    const app = createApp().get('/cookie', async (c) => {
      const store = await cookies();
      store.set('b', '2', { path: '/' });

      return c.json({ a: store.get('a')?.value, b: store.get('b')?.value, size: store.size });
    });

    const response = await app.request('/cookie', { headers: { cookie: 'a=1' } });

    expect(await response.json()).toEqual({ a: '1', b: '2', size: 2 });
    expect(response.headers.getSetCookie()).toEqual(['b=2; Path=/']);
  });

  it('delete() expires the cookie on the response and hides it from later reads', async () => {
    const app = createApp().get('/cookie', async (c) => {
      const store = await cookies();
      store.delete('a');

      return c.json({ has: store.has('a') });
    });

    const response = await app.request('/cookie', { headers: { cookie: 'a=1' } });

    expect(await response.json()).toEqual({ has: false });
    expect(response.headers.getSetCookie()[0]).toMatch(/^a=; Path=\/; Expires=Thu, 01 Jan 1970/);
  });

  it('accepts the object form of set() and delete() with cookie options', async () => {
    const app = createApp().get('/cookie', async (c) => {
      const store = await cookies();
      store.set({ httpOnly: true, name: 's', sameSite: 'lax', value: 'v' });
      store.delete({ name: 'a', path: '/app' });

      return c.json({ all: store.getAll().map((cookie) => cookie.name), text: store.toString() });
    });

    const response = await app.request('/cookie', { headers: { cookie: 'a=1; z=9' } });

    expect(await response.json()).toEqual({ all: ['z', 's'], text: 'z=9; s=v' });
    expect(response.headers.getSetCookie()).toEqual([
      's=v; Path=/; HttpOnly; SameSite=Lax',
      'a=; Path=/app; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    ]);
  });

  it('keeps Set-Cookie when the handler response came from a nested app', async () => {
    const inner = new Hono().get('/nested', async (c) => {
      (await cookies()).set('n', '1');
      return c.text('inner');
    });
    const app = createApp().all('/nested', (c) => inner.fetch(c.req.raw));

    const response = await app.request('/nested');

    expect(await response.text()).toBe('inner');
    expect(response.headers.getSetCookie()).toEqual(['n=1; Path=/']);
  });

  it('draftMode() is always disabled', async () => {
    await expect(draftMode()).resolves.toMatchObject({ isEnabled: false });
  });
});

describe('next-compat after()', () => {
  it('runs the task only after the response was produced', async () => {
    const task = vi.fn();
    const app = createApp().get('/after', (c) => {
      after(task);
      return c.text('sent');
    });

    const response = await app.request('/after');

    expect(await response.text()).toBe('sent');
    expect(task).not.toHaveBeenCalled();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('runs immediately when no request scope exists', async () => {
    const task = vi.fn();

    after(task);
    await new Promise((resolve) => setImmediate(resolve));

    expect(task).toHaveBeenCalledTimes(1);
  });

  it('accepts a pending promise as the task', async () => {
    let resolved = false;
    await runWithRequestContext(new Request('http://localhost/'), async () => {
      after(
        new Promise<void>((resolve) => {
          resolved = true;
          resolve();
        }),
      );
    });

    expect(resolved).toBe(true);
  });
});
