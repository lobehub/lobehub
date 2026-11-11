import { request as httpRequest } from 'node:http';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { APP_HANDOFF_PATHS } from '../protocol';
import { type AppHandoffServer, startAppHandoffServer } from '../server';

let server: AppHandoffServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

const send = (
  port: number,
  { body, headers = {}, method = 'POST', path = APP_HANDOFF_PATHS.code } = {} as {
    body?: string;
    headers?: Record<string, string>;
    method?: string;
    path?: string;
  },
) =>
  new Promise<{ body: any; headers: Record<string, unknown>; status: number }>(
    (resolve, reject) => {
      const req = httpRequest(
        {
          headers: {
            'content-type': 'application/json',
            'host': `127.0.0.1:${port}`,
            ...headers,
          },
          host: '127.0.0.1',
          method,
          path,
          port,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () =>
            resolve({ body: JSON.parse(data), headers: res.headers, status: res.statusCode ?? 0 }),
          );
        },
      );
      req.on('error', reject);
      if (body !== undefined) req.write(body);
      req.end();
    },
  );

describe('app handoff loopback server', () => {
  it('passes a well-formed local request to the handler with the caller port', async () => {
    const handle = vi.fn(async () => ({ body: { ok: true } }));
    server = await startAppHandoffServer(handle);

    const response = await send(server.port, { body: '{"client_id":"x"}' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(handle).toHaveBeenCalledWith({
      body: { client_id: 'x' },
      remotePort: expect.any(Number),
      route: 'code',
    });
  });

  it('serves the status route on GET', async () => {
    const handle = vi.fn(async () => ({ body: { signedIn: true } }));
    server = await startAppHandoffServer(handle);

    const response = await send(server.port, { method: 'GET', path: APP_HANDOFF_PATHS.status });

    expect(response.status).toBe(200);
    expect(handle).toHaveBeenCalledWith(expect.objectContaining({ route: 'status' }));
  });

  it.each([
    ['a rebinding Host header', { headers: { host: 'evil.example:80' } }, 403, 'forbidden'],
    ['localhost as Host', { headers: { host: 'localhost' } }, 403, 'forbidden'],
    ['an Origin header', { headers: { origin: 'https://evil.example' } }, 403, 'forbidden'],
    ['a Sec-Fetch-Site header', { headers: { 'sec-fetch-site': 'cross-site' } }, 403, 'forbidden'],
    ['a Referer header', { headers: { referer: 'https://evil.example/' } }, 403, 'forbidden'],
    [
      'a form body',
      { body: 'a=b', headers: { 'content-type': 'application/x-www-form-urlencoded' } },
      400,
      'invalid_request',
    ],
    [
      'a text/plain body (CORS-simple request)',
      { body: '{}', headers: { 'content-type': 'text/plain' } },
      400,
      'invalid_request',
    ],
    ['malformed JSON', { body: '{' }, 400, 'invalid_request'],
    [
      'an oversized body',
      { body: JSON.stringify({ pad: 'x'.repeat(5000) }) },
      400,
      'invalid_request',
    ],
    ['an unknown path', { body: '{}', path: '/other' }, 404, 'not_found'],
    ['GET on the code route', { body: undefined, method: 'GET' }, 405, 'method_not_allowed'],
    ['a CORS preflight', { body: undefined, method: 'OPTIONS' }, 405, 'method_not_allowed'],
  ])('rejects %s before the handler runs', async (_label, options, status, error) => {
    const handle = vi.fn(async () => ({ body: {} }));
    server = await startAppHandoffServer(handle);

    const response = await send(server.port, { body: '{}', ...options } as any);

    expect(response.status).toBe(status);
    expect(response.body.error).toBe(error);
    expect(handle).not.toHaveBeenCalled();
  });

  it('turns an unexpected handler failure into server_error without details', async () => {
    const onError = vi.fn();
    server = await startAppHandoffServer(
      async () => {
        throw new Error('token xyz leaked?');
      },
      { onError },
    );

    const response = await send(server.port, { body: '{}' });

    expect(response.status).toBe(502);
    expect(response.body).toEqual({ error: 'server_error', error_description: 'handoff failed' });
    expect(onError).toHaveBeenCalled();
  });

  it('binds only the IPv4 loopback interface', async () => {
    server = await startAppHandoffServer(async () => ({ body: {} }));
    const port = server.port;

    // The port is not reachable over IPv6 loopback (nor any other interface).
    await expect(
      new Promise((resolve, reject) => {
        const req = httpRequest({ host: '::1', method: 'GET', path: '/', port }, resolve);
        req.on('error', reject);
        req.end();
      }),
    ).rejects.toThrow();
  });

  it('stops accepting connections once closed', async () => {
    server = await startAppHandoffServer(async () => ({ body: {} }));
    const { port } = server;
    await server.close();
    server = undefined;

    await expect(send(port, { body: '{}' })).rejects.toThrow();
  });
});
