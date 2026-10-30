import type { Server, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ssrfSafeFetch } from './index';

const allowPrivate = { allowPrivateIPAddress: true };

const within = <T>(promise: Promise<T>, ms: number, label: string) =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} did not happen within ${ms}ms`)), ms);
    }),
  ]);

setFlagsFromString('--expose-gc');
const gc = runInNewContext('gc') as () => void;

/** Collects garbage every 100 ms until `settled` resolves or `ms` elapses. */
const collectUntil = async (settled: Promise<unknown>, ms: number) => {
  let done = false;
  void settled.then(() => (done = true));
  for (let waited = 0; !done && waited < ms; waited += 100) {
    gc();
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return done;
};

/** Writes 16 KB chunks until the client goes away; the response never ends on its own. */
const writeForever = (res: ServerResponse) => {
  const chunk = 'x'.repeat(16 * 1024);
  const pump = () => {
    while (!res.destroyed && res.write(chunk));
    if (!res.destroyed) res.once('drain', pump);
  };
  pump();
};

/** Real socket tests: no fetch mocks. */
describe('ssrfSafeFetch network boundary', () => {
  let server: Server;
  let base: string;
  let requests: string[];
  let socketClosed: Map<string, Promise<void>>;

  beforeEach(async () => {
    requests = [];
    socketClosed = new Map();
    server = createServer((req, res) => {
      const path = req.url!;
      requests.push(path);
      socketClosed.set(path, new Promise((resolve) => req.socket.once('close', () => resolve())));

      if (path === '/sse') {
        res.writeHead(200, { 'Cache-Control': 'no-cache', 'Content-Type': 'text/event-stream' });
        res.write('data: hello\n\n');
      } else if (path === '/endless') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        writeForever(res);
      } else if (path === '/endless-error') {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        writeForever(res);
      } else if (path === '/sse-ticking') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        let id = 0;
        const timer = setInterval(() => res.write(`data: ${id++}\n\n`), 50);
        res.once('close', () => clearInterval(timer));
      } else if (path === '/json') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } else if (path === '/redirect-private') {
        res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/' });
        res.end();
      } else if (path === '/reset') {
        res.writeHead(200, { 'Content-Length': '1000', 'Content-Type': 'text/plain' });
        res.write('partial');
        setTimeout(() => req.socket.destroy(), 20);
      } else {
        res.writeHead(204);
        res.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test server address');
    base = `http://127.0.0.1:${address.port}`;
    vi.stubEnv('SSRF_ALLOW_PRIVATE_IP_ADDRESS', undefined);
    vi.stubEnv('SSRF_ALLOW_IP_ADDRESS_LIST', undefined);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('resolves at the headers of a never-ending SSE response and releases it on cancel', async () => {
    const response = await within(
      ssrfSafeFetch(`${base}/sse`, undefined, allowPrivate),
      2000,
      'ssrfSafeFetch resolving',
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream');

    const reader = response.body!.getReader();
    const { value } = await reader.read();
    expect(new TextDecoder().decode(value)).toBe('data: hello\n\n');

    await reader.cancel();
    await within(socketClosed.get('/sse')!, 2000, 'upstream socket close');
  });

  it('soft-truncates at maxContentLength and closes the upstream connection', async () => {
    const response = await ssrfSafeFetch(`${base}/endless`, undefined, {
      ...allowPrivate,
      maxContentLength: 100_000,
    });

    const text = await within(response.text(), 2000, 'reading the capped body');

    expect(text).toBe('x'.repeat(100_000));
    await within(socketClosed.get('/endless')!, 2000, 'upstream socket close');
  });

  it('releases the upstream connection of a response dropped without reading its body', async () => {
    // Same shape as a caller giving up on a non-2xx status: the Response goes out of scope.
    const status = await ssrfSafeFetch(`${base}/endless-error`, undefined, allowPrivate).then(
      (response) => response.status,
    );
    expect(status).toBe(500);

    await expect(collectUntil(socketClosed.get('/endless-error')!, 3000)).resolves.toBe(true);
  });

  it('keeps a stream that is being read alive when its Response is collected', async () => {
    // A long-lived SSE consumer that keeps only its reader, not the Response.
    const reader = await ssrfSafeFetch(`${base}/sse-ticking`, undefined, allowPrivate).then(
      (response) => response.body!.getReader(),
    );
    await reader.read();

    const closedDuringGc = await collectUntil(socketClosed.get('/sse-ticking')!, 1000);
    const { done, value } = await reader.read();

    expect(closedDuringGc).toBe(false);
    expect(done).toBe(false);
    expect(new TextDecoder().decode(value)).toMatch(/^data: \d+/);
    await reader.cancel();
  });

  it('still reads complete bodies through .json()', async () => {
    const response = await ssrfSafeFetch(`${base}/json`, undefined, allowPrivate);

    expect(await response.json()).toEqual({ ok: true });
  });

  it('returns a null body for null-body statuses', async () => {
    const response = await ssrfSafeFetch(`${base}/no-content`, undefined, allowPrivate);

    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
  });

  it('surfaces a connection reset during the body read to the body reader', async () => {
    const response = await ssrfSafeFetch(`${base}/reset`, undefined, allowPrivate);

    await expect(response.text()).rejects.toThrow(/Fetch failed/);
  });

  it('lets the caller signal abort the body read after headers arrive', async () => {
    const controller = new AbortController();
    const response = await ssrfSafeFetch(
      `${base}/sse`,
      { signal: controller.signal },
      allowPrivate,
    );
    const reader = response.body!.getReader();
    await reader.read();

    const pending = reader.read();
    controller.abort();

    await expect(pending).rejects.toThrow(/Fetch failed: .*abort/i);
    await within(socketClosed.get('/sse')!, 2000, 'upstream socket close');
  });

  it('blocks private addresses by default before any request is sent', async () => {
    await expect(ssrfSafeFetch(`${base}/sse`)).rejects.toThrow(/^SSRF blocked: /);
    expect(requests).toEqual([]);
  });

  it('blocks a redirect from an allowed host to a private address', async () => {
    await expect(
      ssrfSafeFetch(`${base}/redirect-private`, undefined, { allowIPAddressList: ['127.0.0.1'] }),
    ).rejects.toThrow(/^SSRF blocked: .*169\.254\.169\.254/);
    expect(requests).toEqual(['/redirect-private']);
  });
});
