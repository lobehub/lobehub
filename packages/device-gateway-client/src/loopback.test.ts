import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { ensureLoopbackBypassesProxy, LoopbackResolver } from './loopback';
import { DeviceTunnelHost } from './tunnel';
import type { TunnelClientFrame } from './types';

describe('LoopbackResolver', () => {
  it('keeps 127.0.0.1 when IPv4 answers', async () => {
    const probe = vi.fn(async () => true);
    expect(await new LoopbackResolver(probe).resolve({ host: '127.0.0.1', port: 3000 })).toBe(
      '127.0.0.1',
    );
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('falls back to ::1 when only IPv6 answers', async () => {
    const probe = vi.fn(async (host: string) => host === '::1');
    expect(await new LoopbackResolver(probe).resolve({ host: '127.0.0.1', port: 5173 })).toBe(
      '::1',
    );
  });

  it('returns 127.0.0.1 when nothing answers, so the real request reports the real error', async () => {
    expect(
      await new LoopbackResolver(async () => false).resolve({ host: '127.0.0.1', port: 9 }),
    ).toBe('127.0.0.1');
  });

  it('caches per port and forgets on demand', async () => {
    const probe = vi.fn(async (host: string) => host === '::1');
    const resolver = new LoopbackResolver(probe);

    await resolver.resolve({ host: '127.0.0.1', port: 5173 });
    await resolver.resolve({ host: '127.0.0.1', port: 5173 });
    expect(probe).toHaveBeenCalledTimes(2); // v4 refused + v6 accepted, once

    resolver.forget(5173);
    await resolver.resolve({ host: '127.0.0.1', port: 5173 });
    expect(probe).toHaveBeenCalledTimes(4);
  });

  it('leaves any other target alone', async () => {
    const probe = vi.fn(async () => false);
    expect(await new LoopbackResolver(probe).resolve({ host: '::1', port: 1 })).toBe('::1');
    expect(probe).not.toHaveBeenCalled();
  });
});

describe('ensureLoopbackBypassesProxy', () => {
  it('adds every loopback spelling, including bracketed ::1, when a proxy is set', () => {
    // The common setting that still proxies `http://[::1]:5173/`.
    const env: NodeJS.ProcessEnv = {
      HTTP_PROXY: 'http://127.0.0.1:7890',
      NO_PROXY: 'localhost, 127.0.0.1, ::1',
    };
    ensureLoopbackBypassesProxy(env);

    expect(env.NO_PROXY?.split(',')).toEqual(['localhost', '127.0.0.1', '::1', '[::1]']);
    expect(env.no_proxy?.split(',')).toEqual(['localhost', '127.0.0.1', '::1', '[::1]']);
  });

  it('keeps existing exclusions and does not duplicate', () => {
    const env: NodeJS.ProcessEnv = { https_proxy: 'http://p:1', no_proxy: 'corp.local,[::1]' };
    ensureLoopbackBypassesProxy(env);
    expect(env.no_proxy).toBe('corp.local,[::1],localhost,127.0.0.1,::1');
  });

  it('leaves the environment alone when no proxy is configured', () => {
    const env: NodeJS.ProcessEnv = { NO_PROXY: 'corp.local' };
    ensureLoopbackBypassesProxy(env);
    expect(env).toEqual({ NO_PROXY: 'corp.local' });
  });
});

describe('tunnel to a dev server bound to ::1 only', () => {
  // What `vite` with no `--host` does on macOS: listen on [::1] alone.
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('served over ::1');
    });
    await new Promise<void>((resolve) => server.listen(0, '::1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('reaches it even though the gateway pins 127.0.0.1', async () => {
    const frames: TunnelClientFrame[] = [];
    const host = new DeviceTunnelHost({ send: (frame) => frames.push(frame) });

    host.handleFrame({
      connId: 'c1',
      head: { headers: [], method: 'GET', path: '/' },
      target: { host: '127.0.0.1', port },
      type: 'tunnel_open',
    });
    host.handleFrame({ connId: 'c1', data: '', fin: true, seq: 1, type: 'tunnel_data' });

    await vi.waitFor(
      () => expect(frames.some((f) => f.type === 'tunnel_data' && f.fin)).toBe(true),
      { timeout: 5000 },
    );
    expect(frames.find((f) => f.type === 'tunnel_open_ack')).toMatchObject({
      head: { status: 200 },
      ok: true,
    });
    const body = frames
      .filter((f) => f.type === 'tunnel_data' && f.data)
      .map((f) => Buffer.from((f as { data: string }).data, 'base64').toString())
      .join('');
    expect(body).toBe('served over ::1');
  });
});
