import { Hono } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';

import { nextCompat } from './next-compat/context';
import { after } from './next-compat/server';
import { createStandaloneServer, resolveStandaloneOptions } from './standaloneServer';

const baseOptions = {
  host: '127.0.0.1',
  keepAliveTimeoutMs: 65_000,
  port: 0,
  shutdownTimeoutMs: 2000,
};
const servers: Array<{ close: () => Promise<unknown> }> = [];

const start = async (app: Hono, overrides: Partial<typeof baseOptions> = {}) => {
  const instance = createStandaloneServer(app, { ...baseOptions, ...overrides });
  await instance.listen();
  servers.push(instance);
  const address = instance.server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  return { ...instance, url: `http://127.0.0.1:${port}` };
};

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

describe('resolveStandaloneOptions', () => {
  it('binds all interfaces only in production by default', () => {
    expect(resolveStandaloneOptions({ NODE_ENV: 'production' }).host).toBe('0.0.0.0');
    expect(resolveStandaloneOptions({ NODE_ENV: 'development' }).host).toBe('localhost');
    expect(resolveStandaloneOptions({ HONO_HOST: '::', NODE_ENV: 'production' }).host).toBe('::');
  });

  it('reads timeouts and port from env with sane fallbacks', () => {
    expect(resolveStandaloneOptions({})).toMatchObject({
      keepAliveTimeoutMs: 65_000,
      port: 3011,
      shutdownTimeoutMs: 10_000,
    });
    expect(
      resolveStandaloneOptions({
        HONO_KEEP_ALIVE_TIMEOUT_MS: '120000',
        HONO_PORT: '4000',
        HONO_SHUTDOWN_TIMEOUT_MS: 'nope',
        PORT: '5000',
      }),
    ).toMatchObject({ keepAliveTimeoutMs: 120_000, port: 4000, shutdownTimeoutMs: 10_000 });
  });
});

describe('createStandaloneServer', () => {
  it('applies keep-alive timeouts to the node server and advertises them', async () => {
    const { server, url } = await start(
      new Hono().get('/', (c) => c.text('ok')),
      {
        keepAliveTimeoutMs: 70_000,
      },
    );

    expect(server.keepAliveTimeout).toBe(70_000);
    expect(server.headersTimeout).toBe(71_000);
    const response = await fetch(`${url}/`);
    expect(response.headers.get('keep-alive')).toBe('timeout=70');
  });

  it('fills x-forwarded-for from the socket only when the proxy did not set it', async () => {
    const app = new Hono().get('/ip', (c) => c.text(c.req.header('x-forwarded-for') ?? 'none'));
    const { url } = await start(app);

    expect(await (await fetch(`${url}/ip`)).text()).toBe('127.0.0.1');
    expect(
      await (
        await fetch(`${url}/ip`, { headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' } })
      ).text(),
    ).toBe('203.0.113.9, 10.0.0.1');
  });

  it('close() waits for after() tasks scheduled by finished requests', async () => {
    let release!: () => void;
    let finished = false;
    const app = new Hono().use('*', nextCompat()).get('/work', (c) => {
      after(
        new Promise<void>((resolve) => {
          release = () => {
            finished = true;
            resolve();
          };
        }),
      );
      return c.text('queued');
    });
    const { close, url } = await start(app);
    await fetch(`${url}/work`);

    let result: string | undefined;
    const closing = close().then((r) => (result = r));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(result).toBeUndefined();

    release();
    await closing;
    expect(finished).toBe(true);
    expect(result).toBe('closed');
  });

  it('close() gives up after the shutdown timeout', async () => {
    const app = new Hono().use('*', nextCompat()).get('/stuck', (c) => {
      after(new Promise<void>(() => {}));
      return c.text('queued');
    });
    const { close, url } = await start(app, { shutdownTimeoutMs: 100 });
    await fetch(`${url}/stuck`);

    await expect(close()).resolves.toBe('timeout');
  });
});
