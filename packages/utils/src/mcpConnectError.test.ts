import { describe, expect, it, vi } from 'vitest';

import {
  classifyMcpConnectFailure,
  connectMcpWithRetry,
  describeMcpEndpoint,
  MCP_CONNECT_PROBE_TIMEOUT_MS,
  MCP_ENDPOINT_UNREACHABLE,
  McpEndpointUnreachableError,
  mcpEndpointUnreachableMessage,
  mcpVersionNegotiation,
  parseMcpEndpointUnreachable,
} from './mcpConnectError';

/** The shape the MCP SDK throws: SdkError(ERA_NEGOTIATION_FAILED) → TypeError → system error. */
const probeFailure = (code?: string, message = `connect ${code} 127.0.0.1:3845`) => {
  const system = Object.assign(new Error(message), code ? { code } : {});
  const fetchError = new TypeError('fetch failed', { cause: system });
  return Object.assign(
    new Error('Version negotiation probe failed: fetch failed', { cause: fetchError }),
    { code: 'ERA_NEGOTIATION_FAILED', name: 'SdkError' },
  );
};

describe('classifyMcpConnectFailure', () => {
  it.each([
    ['ECONNREFUSED', 'refused', true],
    ['ENOTFOUND', 'dns', false],
    ['EAI_AGAIN', 'dns', true],
    ['EHOSTUNREACH', 'unreachable', true],
    ['ENETUNREACH', 'unreachable', true],
    ['ETIMEDOUT', 'timeout', true],
    ['UND_ERR_CONNECT_TIMEOUT', 'timeout', true],
    ['ECONNRESET', 'reset', true],
    ['CERT_HAS_EXPIRED', 'tls', false],
    ['ERR_TLS_CERT_ALTNAME_INVALID', 'tls', false],
  ] as const)('reads %s from the cause chain as %s (retryable: %s)', (code, reason, retryable) => {
    expect(classifyMcpConnectFailure(probeFailure(code))).toMatchObject({
      causeCode: code,
      reason,
      retryable,
    });
  });

  it("never reports the SDK's own code as the network cause", () => {
    expect(classifyMcpConnectFailure(probeFailure(undefined, 'fetch failed'))).toMatchObject({
      causeCode: undefined,
      reason: 'network',
      retryable: true,
    });
  });

  it('reads the bounded probe timeout as a retryable timeout', () => {
    const timeout = Object.assign(
      new Error(`Version negotiation probe timed out after ${MCP_CONNECT_PROBE_TIMEOUT_MS}ms`),
      { code: 'REQUEST_TIMEOUT', name: 'SdkError' },
    );
    expect(classifyMcpConnectFailure(timeout)).toMatchObject({
      causeCode: 'REQUEST_TIMEOUT',
      reason: 'timeout',
      retryable: true,
    });
  });

  it('leaves policy, authorization and protocol failures to their own handling', () => {
    const ssrf = Object.assign(new Error('SSRF blocked: private address'), {
      name: 'SSRFBlockedError',
    });
    expect(classifyMcpConnectFailure(new Error('wrapped', { cause: ssrf }))).toBeUndefined();
    expect(
      classifyMcpConnectFailure(
        Object.assign(new Error('Version negotiation failed: HTTP 401'), { code: 'HTTP_401' }),
      ),
    ).toBeUndefined();
    expect(classifyMcpConnectFailure(new Error('Unknown tool'))).toBeUndefined();
  });
});

describe('connectMcpWithRetry', () => {
  it('retries a retryable failure once on a fresh session, then succeeds', async () => {
    const connect = vi
      .fn()
      .mockRejectedValueOnce(probeFailure('ECONNREFUSED'))
      .mockResolvedValueOnce('session');
    const onRetry = vi.fn();

    await expect(
      connectMcpWithRetry(connect, { endpoint: 'http://x/mcp', onRetry, retryDelayMs: 0 }),
    ).resolves.toBe('session');
    expect(connect).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({ reason: 'refused' }), 1);
  });

  it('gives up after the attempts with the cause, endpoint, timeout and retryability', async () => {
    const connect = vi.fn().mockRejectedValue(probeFailure('ECONNREFUSED'));

    const error = await connectMcpWithRetry(connect, {
      endpoint: 'http://user:pw@192.168.1.1:8080/s/path-secret/mcp?token=secret',
      retryDelayMs: 0,
      via: 'this device',
    }).catch((e) => e);

    expect(McpEndpointUnreachableError.isInstance(error)).toBe(true);
    expect(error.details).toEqual({
      attempts: 2,
      causeCode: 'ECONNREFUSED',
      causeMessage: 'connect ECONNREFUSED 127.0.0.1:3845',
      code: MCP_ENDPOINT_UNREACHABLE,
      endpoint: 'http://192.168.1.1:8080',
      probeTimeoutMs: MCP_CONNECT_PROBE_TIMEOUT_MS,
      reason: 'refused',
      retryable: true,
      via: 'this device',
    });
    expect(error.message).not.toContain('secret');
    expect(error.message).not.toContain('pw@');
  });

  it('does not retry a failure that cannot clear by itself', async () => {
    const connect = vi.fn().mockRejectedValue(probeFailure('ENOTFOUND'));
    const error = await connectMcpWithRetry(connect, { endpoint: 'http://x/mcp' }).catch((e) => e);

    expect(connect).toHaveBeenCalledTimes(1);
    expect(error.details).toMatchObject({ attempts: 1, reason: 'dns', retryable: false });
  });

  it('rethrows any other failure untouched', async () => {
    const other = new Error('MCP server authorization failed');
    const connect = vi.fn().mockRejectedValue(other);

    await expect(connectMcpWithRetry(connect, { endpoint: 'http://x/mcp' })).rejects.toBe(other);
    expect(connect).toHaveBeenCalledTimes(1);
  });
});

describe('parseMcpEndpointUnreachable', () => {
  it('round-trips the details a device reports', () => {
    const details = {
      attempts: 2,
      causeCode: 'EHOSTUNREACH',
      causeMessage: 'connect EHOSTUNREACH 192.168.1.1:8080',
      code: MCP_ENDPOINT_UNREACHABLE,
      endpoint: 'http://192.168.1.1:8080/mcp',
      probeTimeoutMs: 15000,
      reason: 'unreachable',
      retryable: true,
      via: 'this device',
    } as const;

    expect(parseMcpEndpointUnreachable(mcpEndpointUnreachableMessage(details))).toMatchObject({
      attempts: 2,
      causeCode: 'EHOSTUNREACH',
      endpoint: 'http://192.168.1.1:8080/mcp',
      probeTimeoutMs: 15000,
      reason: 'unreachable',
      retryable: true,
    });
  });

  it("gives an older client's bare probe failure the endpoint only the caller knows", () => {
    expect(
      parseMcpEndpointUnreachable('Version negotiation probe failed: fetch failed', {
        endpoint: 'http://192.168.1.1:8080/mcp?k=v',
      }),
    ).toMatchObject({
      endpoint: 'http://192.168.1.1:8080',
      reason: 'network',
      retryable: true,
    });
  });

  it('ignores anything else', () => {
    expect(parseMcpEndpointUnreachable('Unknown tool API: x')).toBeUndefined();
    expect(
      parseMcpEndpointUnreachable(
        'Version negotiation probe failed: the server answered with an unusable reply (x)',
      ),
    ).toBeUndefined();
  });
});

describe('probe bound', () => {
  it('bounds HTTP probes and keeps stdio on the legacy handshake', () => {
    expect(mcpVersionNegotiation('http')).toEqual({
      mode: 'auto',
      probe: { timeoutMs: MCP_CONNECT_PROBE_TIMEOUT_MS },
    });
    expect(mcpVersionNegotiation('stdio')).toEqual({ mode: 'legacy' });
  });

  it('reports only scheme, host and port', () => {
    expect(describeMcpEndpoint('https://a:b@h.example:8443/s/secret/mcp?token=t#x')).toBe(
      'https://h.example:8443',
    );
  });
});
