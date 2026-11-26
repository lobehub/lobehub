import dns from 'node:dns';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createSsrfSafeFetch,
  findSSRFBlockedError,
  SSRFBlockedError,
  validateSsrfAddress,
} from './index';

const expectBlocked = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => undefined,
    (e) => e,
  );
  expect(error).toBeDefined();
  expect(findSSRFBlockedError(error)).toBeInstanceOf(SSRFBlockedError);
};

let server: http.Server;
let origin: string;
let hits: string[] = [];

/** A second origin (same host, different port) for cross-origin redirect cases. */
let crossServer: http.Server;
let crossOrigin: string;
let crossRequests: { authorization?: string; cookie?: string; url?: string }[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    hits.push(req.url!);

    if (req.url === '/redirect-to-metadata') {
      res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' });
      return res.end();
    }

    if (req.url === '/redirect-to-loopback-name') {
      res.writeHead(307, {
        location: `http://localhost:${(server.address() as AddressInfo).port}/ok`,
      });
      return res.end();
    }

    if (req.url === '/redirect-to-ok') {
      res.writeHead(302, { location: '/ok' });
      return res.end();
    }

    if (req.url === '/redirect-cross-origin') {
      res.writeHead(307, { location: `${crossOrigin}/echo` });
      return res.end();
    }

    if (req.url === '/redirect-post-307') {
      res.writeHead(307, { location: '/echo' });
      return res.end();
    }

    if (req.url === '/echo') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            authorization: req.headers.authorization ?? null,
            body,
            method: req.method,
          }),
        );
      });
      return;
    }

    if (req.url === '/stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: first\n\n');
      setTimeout(() => res.end('data: second\n\n'), 300);
      return;
    }

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });

  crossServer = http.createServer((req, res) => {
    crossRequests.push({
      authorization: req.headers.authorization,
      cookie: req.headers.cookie,
      url: req.url,
    });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  await new Promise<void>((resolve) => crossServer.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  crossOrigin = `http://127.0.0.1:${(crossServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await new Promise<void>((resolve) => crossServer.close(() => resolve()));
});

afterEach(() => {
  hits = [];
  crossRequests = [];
  vi.restoreAllMocks();
});

describe('validateSsrfAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    '::',
    'fd00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
    // IPv4-mapped IPv6 is judged by its own `ipv4Mapped` range, not the mapped
    // IPv4's — the same rule `assertSsrfSafeUrl` enforces.
    '::ffff:8.8.8.8',
  ])('blocks %s by default', (address) => {
    expect(validateSsrfAddress(address, {})).toBeInstanceOf(SSRFBlockedError);
  });

  it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])('allows public %s', (address) => {
    expect(validateSsrfAddress(address, {})).toBeUndefined();
  });

  it('honours allowPrivateIPAddress and the allow list (address and CIDR)', () => {
    expect(validateSsrfAddress('10.0.0.1', { allowPrivateIPAddress: true })).toBeUndefined();
    expect(validateSsrfAddress('10.0.0.1', { allowIPAddressList: ['10.0.0.1'] })).toBeUndefined();
    expect(
      validateSsrfAddress('10.0.0.9', { allowIPAddressList: ['10.0.0.0/24'] }),
    ).toBeUndefined();
    expect(validateSsrfAddress('10.0.1.9', { allowIPAddressList: ['10.0.0.0/24'] })).toBeInstanceOf(
      SSRFBlockedError,
    );
  });

  it('deny list wins over allowPrivateIPAddress but loses to the allow list', () => {
    const policy = {
      allowPrivateIPAddress: true,
      denyIPAddressList: ['169.254.0.0/16', 'fe80::/10'],
    };

    expect(validateSsrfAddress('169.254.169.254', policy)).toBeInstanceOf(SSRFBlockedError);
    expect(validateSsrfAddress('fe80::1', policy)).toBeInstanceOf(SSRFBlockedError);
    // IPv4-mapped IPv6 forms of the same link-local destination
    expect(validateSsrfAddress('::ffff:a9fe:a9fe', policy)).toBeInstanceOf(SSRFBlockedError);
    expect(validateSsrfAddress('::ffff:169.254.169.254', policy)).toBeInstanceOf(SSRFBlockedError);
    expect(validateSsrfAddress('10.0.0.1', policy)).toBeUndefined();
    expect(
      validateSsrfAddress('169.254.169.254', {
        ...policy,
        allowIPAddressList: ['169.254.169.254'],
      }),
    ).toBeUndefined();
  });
});

describe('createSsrfSafeFetch', () => {
  it('blocks a loopback baseURL before any request reaches the server', async () => {
    await expectBlocked(createSsrfSafeFetch()(`${origin}/v1/chat/completions`));
    expect(hits).toHaveLength(0);
  });

  it.each([
    'http://2130706433/',
    'http://0x7f.1/',
    'http://127.1/',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[fd00::1]/',
    'http://169.254.169.254/latest/meta-data/',
  ])('blocks the obfuscated private address %s', async (url) => {
    await expectBlocked(createSsrfSafeFetch()(url));
  });

  it('blocks a hostname that resolves to a private address (DNS rebinding)', async () => {
    vi.spyOn(dns, 'lookup').mockImplementation(((
      _hostname: string,
      options: dns.LookupOptions,
      callback: (...args: unknown[]) => void,
    ) => {
      if (options?.all) return callback(null, [{ address: '10.0.0.7', family: 4 }]);
      callback(null, '10.0.0.7', 4);
    }) as any);

    await expectBlocked(createSsrfSafeFetch()('http://rebind.example.com/v1/models'));
    expect(dns.lookup).toHaveBeenCalled();
  });

  it('blocks localhost because the resolved loopback address is checked', async () => {
    const port = (server.address() as AddressInfo).port;
    await expectBlocked(createSsrfSafeFetch()(`http://localhost:${port}/ok`));
    expect(hits).toHaveLength(0);
  });

  it('re-validates every redirect hop: an allowed host redirecting to a private address is blocked', async () => {
    const guardedFetch = createSsrfSafeFetch({ allowIPAddressList: ['127.0.0.1'] });

    await expectBlocked(guardedFetch(`${origin}/redirect-to-metadata`));
    // The first hop was allowed and served; only the redirect target was refused
    expect(hits).toEqual(['/redirect-to-metadata']);
  });

  it('blocks a redirect to a hostname resolving to loopback even when the IP literal is allow-listed', async () => {
    vi.spyOn(dns, 'lookup').mockImplementation(((
      _hostname: string,
      options: dns.LookupOptions,
      callback: (...args: unknown[]) => void,
    ) => {
      if (options?.all) return callback(null, [{ address: '::1', family: 6 }]);
      callback(null, '::1', 6);
    }) as any);

    const guardedFetch = createSsrfSafeFetch({ allowIPAddressList: ['127.0.0.1'] });

    await expectBlocked(guardedFetch(`${origin}/redirect-to-loopback-name`));
    expect(hits).toEqual(['/redirect-to-loopback-name']);
  });

  it('allows private targets when the policy allows them', async () => {
    const res = await createSsrfSafeFetch({ allowPrivateIPAddress: true })(`${origin}/ok`);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('allows an allow-listed address and streams the body without buffering it', async () => {
    const res = await createSsrfSafeFetch({ allowIPAddressList: ['127.0.0.1'] })(
      `${origin}/stream`,
    );
    expect(res).toBeInstanceOf(Response);

    const reader = res.body!.getReader();
    const first = await reader.read();

    // The server sends the first SSE event immediately and the second only
    // after a delay, so a body buffered to completion would deliver both
    // events in the first chunk.
    const firstEvent = new TextDecoder().decode(first.value);
    expect(firstEvent).toContain('data: first');
    expect(firstEvent).not.toContain('data: second');

    let rest = '';
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      rest += new TextDecoder().decode(chunk.value);
    }
    expect(rest).toContain('data: second');
  });

  it('works as an SDK fetch with POST bodies and abort signals', async () => {
    const controller = new AbortController();
    const res = await createSsrfSafeFetch({ allowIPAddressList: ['127.0.0.1'] })(`${origin}/ok`, {
      body: JSON.stringify({ model: 'x' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
      signal: controller.signal,
    });
    expect(res.status).toBe(200);
  });

  it('falls back to application-layer checks on Bun, whose fetch ignores dispatchers', async () => {
    const baseFetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
    (process.versions as Record<string, string | undefined>).bun = '1.4.4';
    try {
      // private targets are still refused — at resolution time rather than connect time
      await expectBlocked(createSsrfSafeFetch({}, { fetch: baseFetch })(`${origin}/ok`));
      expect(baseFetch).not.toHaveBeenCalled();
      expect(hits).toHaveLength(0);

      // allowed targets go through the base fetch with no dispatcher attached
      const res = await createSsrfSafeFetch(
        { allowIPAddressList: ['127.0.0.1'] },
        { fetch: baseFetch },
      )(`${origin}/ok`);
      expect(res.status).toBe(200);
      expect((baseFetch.mock.calls[0][1] as RequestInit).dispatcher).toBeUndefined();
    } finally {
      delete (process.versions as Record<string, string | undefined>).bun;
    }
  });
});

describe('createSsrfSafeFetch with an environment proxy (NODE_USE_ENV_PROXY=1)', () => {
  // The env vars only select the proxy code path; the injected base fetch
  // connects directly, standing in for the proxied global fetch.
  const proxiedFetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));

  beforeEach(() => {
    vi.stubEnv('NODE_USE_ENV_PROXY', '1');
    vi.stubEnv('HTTPS_PROXY', 'http://proxy.example.com:3128');
    proxiedFetch.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const createProxyModeFetch = () =>
    createSsrfSafeFetch({ allowIPAddressList: ['127.0.0.1'] }, { fetch: proxiedFetch });

  it('blocks a private target before handing it to the proxy', async () => {
    await expectBlocked(createSsrfSafeFetch({}, { fetch: proxiedFetch })(`${origin}/ok`));
    expect(proxiedFetch).not.toHaveBeenCalled();
    expect(hits).toHaveLength(0);
  });

  it('re-validates redirect hops: an allowed endpoint redirecting to the metadata address is blocked', async () => {
    await expectBlocked(createProxyModeFetch()(`${origin}/redirect-to-metadata`));

    expect(hits).toEqual(['/redirect-to-metadata']);
    expect(proxiedFetch).toHaveBeenCalledTimes(1);
    expect(proxiedFetch.mock.calls[0][1]).toMatchObject({ redirect: 'manual' });
  });

  it('re-resolves redirect hostnames: a redirect to a name resolving to loopback is blocked', async () => {
    vi.spyOn(dns.promises, 'lookup').mockResolvedValue([{ address: '::1', family: 6 }] as any);

    await expectBlocked(createProxyModeFetch()(`${origin}/redirect-to-loopback-name`));
    expect(hits).toEqual(['/redirect-to-loopback-name']);
  });

  it('still follows redirects between allowed targets', async () => {
    const res = await createProxyModeFetch()(`${origin}/redirect-to-ok`);

    expect(await res.json()).toEqual({ ok: true });
    expect(hits).toEqual(['/redirect-to-ok', '/ok']);
  });

  it("preserves a Request input's abort signal across hops", async () => {
    const request = new Request(`${origin}/redirect-post-307`, {
      body: 'payload',
      method: 'POST',
      signal: AbortSignal.abort(),
    });

    await expect(createProxyModeFetch()(request)).rejects.toThrowError(/abort/i);
    expect(hits).toHaveLength(0);
  });

  it('strips credentials when a redirect crosses origins', async () => {
    const res = await createProxyModeFetch()(`${origin}/redirect-cross-origin`, {
      headers: { authorization: 'Bearer secret', cookie: 'session=private' },
    });

    expect(res.status).toBe(200);
    expect(crossRequests).toEqual([{ authorization: undefined, cookie: undefined, url: '/echo' }]);
  });

  it("keeps a Request input's method, headers and body across a same-origin redirect", async () => {
    const request = new Request(`${origin}/redirect-post-307`, {
      body: 'payload',
      headers: { authorization: 'Bearer keep-me' },
      method: 'POST',
    });

    const res = await createProxyModeFetch()(request);

    expect(await res.json()).toEqual({
      authorization: 'Bearer keep-me',
      body: 'payload',
      method: 'POST',
    });
  });
});

describe('createSsrfSafeFetch with an installed global proxy dispatcher', () => {
  // The dev server installs EnvHttpProxyAgent via setGlobalDispatcher when
  // HTTP(S)_PROXY is set, WITHOUT NODE_USE_ENV_PROXY. A per-request dispatcher
  // would bypass that proxy entirely.
  let proxyHits = 0;
  let proxy: http.Server;

  beforeAll(async () => {
    proxy = http.createServer((_req, res) => {
      res.writeHead(502).end();
    });
    // undici's proxy agents CONNECT-tunnel everything; answer the tunnel and
    // serve the wrapped request ourselves, proving the request took the proxy.
    proxy.on('connect', (_req, sock) => {
      proxyHits++;
      sock.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      sock.once('data', () => {
        sock.end(
          'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 16\r\n\r\n{"proxied":true}',
        );
      });
    });
    await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
  });

  afterEach(() => {
    proxyHits = 0;
  });

  it('routes through the global proxy dispatcher instead of bypassing it', async () => {
    const { EnvHttpProxyAgent, getGlobalDispatcher, setGlobalDispatcher } = await import('undici');
    const previous = getGlobalDispatcher();
    const proxyUrl = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
    // `noProxy` overrides any NO_PROXY inherited from the test environment
    setGlobalDispatcher(
      new EnvHttpProxyAgent({ httpProxy: proxyUrl, httpsProxy: proxyUrl, noProxy: '' }),
    );

    try {
      const res = await createSsrfSafeFetch({ allowIPAddressList: ['127.0.0.1'] })(`${origin}/ok`);

      expect(await res.json()).toEqual({ proxied: true });
      expect(proxyHits).toBe(1);
      // the request never reached the target directly
      expect(hits).toHaveLength(0);
    } finally {
      setGlobalDispatcher(previous);
    }
  });
});
