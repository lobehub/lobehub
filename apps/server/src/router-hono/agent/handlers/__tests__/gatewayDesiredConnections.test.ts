// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { gatewayDesiredConnections } from '../gatewayDesiredConnections';

const { gatewayEnvState, hostConfigured, mockListDesired } = vi.hoisted(() => ({
  gatewayEnvState: {} as {
    MESSAGE_GATEWAY_ENABLED?: string;
    MESSAGE_GATEWAY_SERVICE_TOKEN?: string;
  },
  hostConfigured: { value: true },
  mockListDesired: vi.fn(),
}));

vi.mock('@/envs/gateway', () => ({
  gatewayEnv: new Proxy(gatewayEnvState, {
    get: (target, prop: string) => target[prop as keyof typeof target],
  }),
}));

vi.mock('@/server/services/gateway', () => ({
  GatewayService: class {
    listDesiredConnectionsForHost = mockListDesired;
  },
}));

vi.mock('@/server/services/gateway/MessageGatewayClient', () => ({
  isMessageGatewayHostConfigured: () => hostConfigured.value,
}));

function buildContext(opts: { authHeader?: string; body?: unknown; jsonThrows?: boolean }) {
  return {
    body: (b: any, status: number) => new Response(b, { status }),
    json: (b: any, status = 200) => Response.json(b, { status }),
    req: {
      header: (name: string) =>
        name.toLowerCase() === 'authorization' ? opts.authHeader : undefined,
      json: opts.jsonThrows
        ? async () => {
            throw new Error('bad json');
          }
        : async () => opts.body,
    },
  } as any;
}

const AUTH = 'Bearer service-token';

describe('gatewayDesiredConnections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    gatewayEnvState.MESSAGE_GATEWAY_ENABLED = '1';
    gatewayEnvState.MESSAGE_GATEWAY_SERVICE_TOKEN = 'service-token';
    hostConfigured.value = true;
    mockListDesired.mockResolvedValue({ complete: true, connections: [], excluded: 0 });
  });

  // The disabled short-circuit runs before auth on purpose: a deployment with
  // the gateway switched off should go quiet, not start 401-ing a gateway that
  // has not been told to stop yet.
  it('returns 204 when the gateway feature is off, before checking auth', async () => {
    gatewayEnvState.MESSAGE_GATEWAY_ENABLED = undefined;
    gatewayEnvState.MESSAGE_GATEWAY_SERVICE_TOKEN = undefined;

    const res = await gatewayDesiredConnections(buildContext({ body: { host: 'node' } }));

    expect(res.status).toBe(204);
    expect(mockListDesired).not.toHaveBeenCalled();
  });

  it('returns 503 when no service token is configured', async () => {
    gatewayEnvState.MESSAGE_GATEWAY_SERVICE_TOKEN = undefined;

    const res = await gatewayDesiredConnections(
      buildContext({ authHeader: AUTH, body: { host: 'node' } }),
    );

    expect(res.status).toBe(503);
    expect(mockListDesired).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', undefined],
    ['wrong', 'Bearer nope'],
  ])('returns 401 on a %s authorization header', async (_label, authHeader) => {
    const res = await gatewayDesiredConnections(
      buildContext({ authHeader, body: { host: 'node' } }),
    );

    expect(res.status).toBe(401);
    expect(mockListDesired).not.toHaveBeenCalled();
  });

  it('returns 400 on unparseable JSON', async () => {
    const res = await gatewayDesiredConnections(
      buildContext({ authHeader: AUTH, jsonThrows: true }),
    );

    expect(res.status).toBe(400);
  });

  it('returns 400 on an unknown host', async () => {
    const res = await gatewayDesiredConnections(
      buildContext({ authHeader: AUTH, body: { host: 'somewhere-else' } }),
    );

    expect(res.status).toBe(400);
    expect(mockListDesired).not.toHaveBeenCalled();
  });

  // `host` is caller-controlled and every gateway authenticates with the same
  // service token, so a token that leaks out of one gateway must not be able
  // to name a different one and read its credentials. Only the host that
  // actually rebuilds this way may be asked for.
  it('refuses a pull for the host that does not rebuild by pulling', async () => {
    const res = await gatewayDesiredConnections(
      buildContext({ authHeader: AUTH, body: { host: 'default' } }),
    );

    expect(res.status).toBe(403);
    expect(mockListDesired).not.toHaveBeenCalled();
  });

  // An empty list would tell the caller "hold nothing" and stop its retry.
  // "I do not route to you yet" is a different statement and has to stay
  // retryable, or a gateway that boots before its URL is configured never
  // recovers.
  it('returns a retryable 503 for a host this deployment does not route to', async () => {
    hostConfigured.value = false;

    const res = await gatewayDesiredConnections(
      buildContext({ authHeader: AUTH, body: { host: 'node' } }),
    );

    expect(res.status).toBe(503);
    expect(mockListDesired).not.toHaveBeenCalled();
  });

  it('returns the desired connections for the requested host', async () => {
    const payload = {
      complete: true,
      connections: [{ config: { connectionId: 'prov-1' }, ensure: true }],
      excluded: 2,
    };
    mockListDesired.mockResolvedValue(payload);

    const res = await gatewayDesiredConnections(
      buildContext({ authHeader: AUTH, body: { host: 'node' } }),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(payload);
    expect(mockListDesired).toHaveBeenCalledWith('node');
  });
});
