// @vitest-environment node
import dns from 'node:dns';
import type { Server } from 'node:http';
import { createServer } from 'node:http';
import { syncBuiltinESMExports } from 'node:module';
import net from 'node:net';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MCPClient } from '../client';
import { MCP_SSRF_BLOCKED_MESSAGE } from '../ssrf';
import { startNegotiationServers } from './fixtures/negotiationServers';

/** Resolves to a private address, like an intranet name or `10.0.0.1.nip.io`. */
const PRIVATE_HOST = 'mcp.intranet.example';
/** Resolves to a public address; the socket is then pointed at the local fixture. */
const PUBLIC_HOST = 'mcp.public.example';
const PUBLIC_IP = '93.184.215.14';

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | dns.LookupAddress[],
  family?: number,
) => void;

/**
 * Mock DNS for the names `resolve` answers, and point a socket the SSRF policy
 * accepted for `PUBLIC_IP` at the local fixture instead, so no test leaves the
 * machine. The policy (request-filtering-agent) still sees the mocked answer.
 */
const mockNetwork = (resolve: (hostname: string) => string | undefined) => {
  const realLookup = dns.lookup;
  vi.spyOn(dns, 'lookup').mockImplementation(((
    hostname: string,
    options: unknown,
    callback?: LookupCallback,
  ) => {
    const cb = (typeof options === 'function' ? options : callback) as LookupCallback;
    const address = resolve(hostname);
    if (!address) return (realLookup as any)(hostname, options, callback);
    const all = typeof options === 'object' && !!(options as dns.LookupOptions)?.all;
    process.nextTick(() => (all ? cb(null, [{ address, family: 4 }]) : cb(null, address, 4)));
  }) as typeof dns.lookup);
  // request-filtering-agent reads `lookup` from the `node:dns` ES module namespace
  syncBuiltinESMExports();

  const realConnect = net.Socket.prototype.connect;
  vi.spyOn(net.Socket.prototype, 'connect').mockImplementation(function (
    this: net.Socket,
    ...args: any[]
  ) {
    // `net.createConnection` passes its normalized `[options, callback]` array
    const holder: any[] = Array.isArray(args[0]) ? args[0] : args;
    const [options] = holder;
    if (options && typeof options === 'object' && typeof options.lookup === 'function') {
      const policyLookup = options.lookup;
      const toFixture = (address: string) => (address === PUBLIC_IP ? '127.0.0.1' : address);
      holder[0] = {
        ...options,
        lookup: (host: string, lookupOptions: dns.LookupOptions, cb: LookupCallback) =>
          policyLookup(host, lookupOptions, (err: any, address: any, family: any) => {
            if (err) return cb(err, address, family);
            if (!Array.isArray(address)) return cb(null, toFixture(address), family);
            cb(
              null,
              address.map((entry: dns.LookupAddress) => ({
                ...entry,
                address: toFixture(entry.address),
              })),
            );
          }),
      };
    }
    return (realConnect as any).apply(this, args);
  } as any);
};

const restoreNetwork = () => {
  vi.restoreAllMocks();
  syncBuiltinESMExports();
};

/**
 * Real socket tests: no fetch mocks. The MCP server URL comes from whoever
 * configured the server and its response is returned to them, so every request
 * the transport makes must be checked against the IP it actually resolves to.
 */
describe('MCPClient HTTP SSRF boundary', () => {
  let servers: Awaited<ReturnType<typeof startNegotiationServers>>;
  let port: number;
  /** Per-host answers of the mocked DNS, consumed in order (the last one repeats). */
  let dnsAnswers: Map<string, string[]>;
  const clients: MCPClient[] = [];

  const clientFor = (url: string) => {
    const client = new MCPClient({ name: 'ssrf-test', type: 'http', url });
    clients.push(client);
    return client;
  };

  beforeEach(async () => {
    servers = await startNegotiationServers();
    port = Number(new URL(servers.url).port);
    dnsAnswers = new Map([
      [PRIVATE_HOST, ['127.0.0.1']],
      [PUBLIC_HOST, [PUBLIC_IP]],
    ]);

    mockNetwork((hostname) => {
      const answers = dnsAnswers.get(hostname);
      if (!answers) return;
      return answers.length > 1 ? answers.shift() : answers[0];
    });

    vi.stubEnv('SSRF_ALLOW_PRIVATE_IP_ADDRESS', undefined);
    vi.stubEnv('SSRF_ALLOW_IP_ADDRESS_LIST', undefined);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    await Promise.allSettled(clients.splice(0).map((client) => client.disconnect()));
    await servers.close();
    vi.unstubAllEnvs();
    restoreNetwork();
  });

  const expectSSRFBlocked = async (promise: Promise<unknown>) => {
    const error: any = await promise.then(
      () => undefined,
      (e) => e,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe(MCP_SSRF_BLOCKED_MESSAGE);
    expect(error.data).toMatchObject({
      metadata: { originalError: expect.stringContaining('SSRF blocked: ') },
      type: 'SSRF_BLOCKED',
    });
    return error;
  };

  it('refuses a host name that resolves to a private address', async () => {
    const error = await expectSSRFBlocked(
      clientFor(`http://${PRIVATE_HOST}:${port}/legacy`).initialize(),
    );
    expect(error.data.metadata.originalError).toContain(`host:${PRIVATE_HOST}`);
    expect(servers.requests).toEqual([]);
  });

  it('keeps the guard on a client that announces MCP Events', async () => {
    // Events wraps the transport fetch to add Mcp-Name; that wrapper must sit on the guarded fetch.
    const client = new MCPClient(
      { name: 'ssrf-test', type: 'http', url: `http://${PRIVATE_HOST}:${port}/legacy` },
      { mcpEvents: true },
    );
    clients.push(client);
    await expectSSRFBlocked(client.initialize());
    expect(servers.requests).toEqual([]);
  });

  it('refuses the cloud metadata address', async () => {
    await expectSSRFBlocked(clientFor('http://169.254.169.254/latest/mcp').initialize());
  });

  it.each([
    ['loopback', `http://127.0.0.1:${0}/legacy`],
    ['IPv4-mapped IPv6 loopback', 'http://[::ffff:127.0.0.1]/legacy'],
    ['IPv6 unique local', 'http://[fd00::1]/legacy'],
    ['IPv6 link-local', 'http://[fe80::1]/legacy'],
    ['carrier-grade NAT', 'http://100.64.0.1/legacy'],
  ])('refuses a %s address', async (_, url) => {
    await expectSSRFBlocked(clientFor(url.replace(':0/', `:${port}/`)).initialize());
    expect(servers.requests).toEqual([]);
  });

  it('runs a tool on a host name that resolves to a public address', async () => {
    const client = clientFor(`http://${PUBLIC_HOST}:${port}/legacy`);
    await client.initialize();

    await expect(client.callTool('echo', {})).resolves.toMatchObject({
      content: [{ text: 'MCP negotiation tool succeeded', type: 'text' }],
    });
    expect(servers.requests.map((request) => request.method)).toEqual(
      expect.arrayContaining(['initialize', 'tools/call']),
    );
  });

  it('reaches a private address when SSRF_ALLOW_PRIVATE_IP_ADDRESS is set', async () => {
    vi.stubEnv('SSRF_ALLOW_PRIVATE_IP_ADDRESS', '1');
    const client = clientFor(`http://${PRIVATE_HOST}:${port}/legacy`);
    await client.initialize();

    await expect(client.listTools()).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'echo' })]),
    );
  });

  it('reaches an address listed in SSRF_ALLOW_IP_ADDRESS_LIST', async () => {
    vi.stubEnv('SSRF_ALLOW_IP_ADDRESS_LIST', '127.0.0.1');
    const client = clientFor(`${servers.url}/legacy`);
    await client.initialize();

    await expect(client.callTool('echo', {})).resolves.toMatchObject({
      content: [{ text: 'MCP negotiation tool succeeded', type: 'text' }],
    });
  });

  it('refuses a later request once the host resolves to a private address', async () => {
    // DNS rebinding: the first lookups pass the policy, then the name points inside.
    const client = clientFor(`http://${PUBLIC_HOST}:${port}/legacy`);
    await client.initialize();
    dnsAnswers.set(PUBLIC_HOST, ['127.0.0.1']);
    const before = servers.requests.length;

    await expectSSRFBlocked(client.callTool('echo', {}));
    expect(servers.requests.length).toBe(before);
  });
});

describe('MCPClient HTTP SSRF boundary on redirects', () => {
  let server: Server;
  let port: number;
  let requests: string[];
  let lookups: string[];

  beforeEach(async () => {
    requests = [];
    lookups = [];
    server = createServer((req, res) => {
      requests.push(req.url!);
      if (req.url === '/to-metadata') {
        res.writeHead(307, { Location: 'http://169.254.169.254/latest/meta-data/' });
      } else {
        res.writeHead(307, { Location: '/rebound' });
      }
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as net.AddressInfo).port;

    mockNetwork((hostname) => {
      if (hostname !== PUBLIC_HOST) return;
      // The first connection resolves publicly, every later one to loopback.
      const address = lookups.length === 0 ? PUBLIC_IP : '127.0.0.1';
      lookups.push(address);
      return address;
    });

    vi.stubEnv('SSRF_ALLOW_PRIVATE_IP_ADDRESS', undefined);
    vi.stubEnv('SSRF_ALLOW_IP_ADDRESS_LIST', undefined);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    vi.unstubAllEnvs();
    restoreNetwork();
  });

  it('refuses a same-origin redirect whose host now resolves to a private address', async () => {
    const client = new MCPClient({
      name: 'ssrf-redirect-test',
      type: 'http',
      url: `http://${PUBLIC_HOST}:${port}/start`,
    });

    const error: any = await client.initialize().then(
      () => undefined,
      (e) => e,
    );
    expect(error?.data?.type).toBe('SSRF_BLOCKED');
    // The redirect was answered once; its target was never requested.
    expect(requests).toEqual(['/start']);
    expect(lookups).toEqual([PUBLIC_IP, '127.0.0.1']);
  });

  it('never requests a cross-origin redirect to the cloud metadata address', async () => {
    const client = new MCPClient({
      name: 'ssrf-redirect-test',
      type: 'http',
      url: `http://${PUBLIC_HOST}:${port}/to-metadata`,
    });

    await expect(client.initialize()).rejects.toThrow();
    expect(requests).toEqual(['/to-metadata']);
  });
});
