/**
 * Regression (T-14043): every tool of a LAN / localhost MCP server (openwrt, the
 * JLC EDA app) failed with the SDK's bare "Version negotiation probe failed:
 * fetch failed" — no cause, no endpoint, a 60 s probe, no retry.
 *
 * Real code under test, over real sockets: DeviceMcpRuntime → MCPClient → the
 * MCP SDK's version-negotiation probe → Node fetch. Nothing is mocked.
 */
import { createServer as createHttpServer } from 'node:http';
import { createServer, type Server } from 'node:net';

import {
  MCP_CONNECT_MAX_ATTEMPTS,
  MCP_CONNECT_PROBE_TIMEOUT_MS,
  MCP_ENDPOINT_UNREACHABLE,
  McpEndpointUnreachableError,
} from '@lobechat/utils/mcpConnectError';
import { afterEach, describe, expect, it } from 'vitest';

import { startNegotiationServers } from '../../../src/libs/mcp/__tests__/fixtures/negotiationServers';
import { DeviceMcpRuntime } from './runtime';

const freePort = async () => {
  const probe: Server = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as { port: number };
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
};

/** The runtime's "retrying on a fresh session" warnings, one per retry. */
const warnings: unknown[][] = [];
const runtime = () =>
  new DeviceMcpRuntime({
    clientName: 'repro-device',
    getMediaUrl: async (key) => key,
    logger: {
      error: () => {},
      warn: (...args) => {
        if (String(args[0]).startsWith('MCP server unreachable, retrying')) warnings.push(args);
      },
    },
    uploadMedia: async () => 'key',
  });

const report = (label: string, error: unknown) => {
  const e = error as McpEndpointUnreachableError;
  console.log(
    `[T-14043 probe repro] ${label}\n  message: ${e.message}\n  details: ${JSON.stringify(e.details)}\n  retries logged: ${JSON.stringify(warnings)}`,
  );
};

describe('device MCP client: unreachable endpoint (T-14043)', () => {
  const cleanups: (() => Promise<unknown>)[] = [];
  afterEach(async () => {
    warnings.length = 0;
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  it('nothing listening: classified as refused, endpoint named, retried once, marked retryable', async () => {
    const url = `http://127.0.0.1:${await freePort()}/mcp?token=secret`;
    const started = Date.now();

    const error = await runtime()
      .runTool({ name: 'openwrt', type: 'http', url }, 'system_info', '{}')
      .catch((e) => e);
    report('nothing listening on the port', error);

    expect(McpEndpointUnreachableError.isInstance(error)).toBe(true);
    expect(error.details).toMatchObject({
      attempts: MCP_CONNECT_MAX_ATTEMPTS,
      causeCode: 'ECONNREFUSED',
      code: MCP_ENDPOINT_UNREACHABLE,
      probeTimeoutMs: MCP_CONNECT_PROBE_TIMEOUT_MS,
      reason: 'refused',
      retryable: true,
      via: 'this device',
    });
    // The endpoint is named without its path and query (either can carry a token)
    expect(error.details.endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(error.message).not.toContain('secret');
    expect(error.message).not.toMatch(/^Version negotiation probe failed: fetch failed$/);
    // One retry was logged before giving up
    expect(warnings).toHaveLength(1);
    expect(warnings[0][1]).toMatchObject({ attempt: 1, causeCode: 'ECONNREFUSED' });
    // Bounded: a refused port fails fast, far below the probe timeout
    expect(Date.now() - started).toBeLessThan(MCP_CONNECT_PROBE_TIMEOUT_MS);
  });

  it('server comes up after the first attempt failed: the retry connects and the tool runs', async () => {
    const port = await freePort();
    const rt = runtime();

    // The app hosting the MCP server finishes starting while the first attempt fails
    const pending = rt.runTool(
      { name: 'eda', type: 'http', url: `http://127.0.0.1:${port}/modern` },
      'echo',
      '{}',
    );
    const servers = await new Promise<Awaited<ReturnType<typeof startNegotiationServers>>>(
      (resolve) => {
        const poll = setInterval(() => {
          if (warnings.length === 0) return;
          clearInterval(poll);
          resolve(startNegotiationServers(port));
        }, 10);
      },
    );
    cleanups.push(
      () => servers.close(),
      () => rt.dispose(),
    );

    const result = await pending;
    console.log(
      `[T-14043 probe repro] server started after the first refused attempt\n  retries logged: ${JSON.stringify(warnings)}\n  result: ${JSON.stringify(result)}`,
    );

    expect(warnings).toHaveLength(1);
    expect(result).toMatchObject({ content: 'MCP negotiation tool succeeded', success: true });
  });

  it('host name that does not resolve: classified as dns, not retried, not retryable', async () => {
    const error = await runtime()
      .runTool({ name: 'openwrt', type: 'http', url: 'http://openwrt.invalid/mcp' }, 'x', '{}')
      .catch((e) => e);
    report('host name does not resolve', error);

    expect(error.details).toMatchObject({
      attempts: 1,
      causeCode: 'ENOTFOUND',
      endpoint: 'http://openwrt.invalid',
      reason: 'dns',
      retryable: false,
    });
    expect(warnings).toHaveLength(0);
  });

  // Takes 2 × MCP_CONNECT_PROBE_TIMEOUT_MS; run with MCP_REPRO_SLOW=1.
  it.runIf(process.env.MCP_REPRO_SLOW === '1')(
    'server accepts but never answers: the probe gives up after its bounded timeout, then retries',
    async () => {
      const silent = createHttpServer(() => {});
      await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', resolve));
      cleanups.push(
        () =>
          new Promise((resolve) => {
            silent.closeAllConnections();
            silent.close(resolve);
          }),
      );
      const { port } = silent.address() as { port: number };
      const started = Date.now();

      const error = await runtime()
        .runTool({ name: 'openwrt', type: 'http', url: `http://127.0.0.1:${port}/mcp` }, 'x', '{}')
        .catch((e) => e);
      const elapsed = Date.now() - started;
      report(`server never answers (elapsed ${elapsed} ms)`, error);

      expect(error.details).toMatchObject({
        attempts: 2,
        causeCode: 'REQUEST_TIMEOUT',
        probeTimeoutMs: MCP_CONNECT_PROBE_TIMEOUT_MS,
        reason: 'timeout',
        retryable: true,
      });
      expect(elapsed).toBeLessThan(MCP_CONNECT_PROBE_TIMEOUT_MS * 2 + 5000);
    },
    MCP_CONNECT_PROBE_TIMEOUT_MS * 2 + 10_000,
  );
});
