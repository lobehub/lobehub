// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { gatewayDesiredConnections } from '../gatewayDesiredConnections';

const { gatewayEnvState, hostConfigured, mockListDesired } = vi.hoisted(() => ({
  gatewayEnvState: {} as {
    MESSAGE_GATEWAY_ENABLED?: string;
    MESSAGE_GATEWAY_NODE_PULL_TOKEN?: string;
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

function buildContext(authHeader?: string) {
  return {
    body: (b: any, status: number) => new Response(b, { status }),
    json: (b: any, status = 200) => Response.json(b, { status }),
    req: {
      header: (name: string) => (name.toLowerCase() === 'authorization' ? authHeader : undefined),
    },
  } as any;
}

const PULL = 'Bearer node-pull-token';

describe('gatewayDesiredConnections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    gatewayEnvState.MESSAGE_GATEWAY_ENABLED = '1';
    gatewayEnvState.MESSAGE_GATEWAY_NODE_PULL_TOKEN = 'node-pull-token';
    gatewayEnvState.MESSAGE_GATEWAY_SERVICE_TOKEN = 'shared-service-token';
    hostConfigured.value = true;
    mockListDesired.mockResolvedValue({
      complete: true,
      connections: [],
      deferred: 0,
      excluded: 0,
    });
  });

  // The disabled short-circuit runs before the credential check on purpose: a
  // deployment with the gateway switched off should go quiet, not start 401-ing
  // a gateway that has not been told to stop yet.
  it('returns 204 when the gateway feature is off, before checking the credential', async () => {
    gatewayEnvState.MESSAGE_GATEWAY_ENABLED = undefined;
    gatewayEnvState.MESSAGE_GATEWAY_NODE_PULL_TOKEN = undefined;

    const res = await gatewayDesiredConnections(buildContext());

    expect(res.status).toBe(204);
    expect(mockListDesired).not.toHaveBeenCalled();
  });

  it('returns a retryable 503 when no pull credential is configured', async () => {
    gatewayEnvState.MESSAGE_GATEWAY_NODE_PULL_TOKEN = undefined;

    const res = await gatewayDesiredConnections(buildContext(PULL));

    expect(res.status).toBe(503);
    expect(mockListDesired).not.toHaveBeenCalled();
  });

  // The point of the whole credential. The shared service token authenticates
  // the connection-management surface and is written into stored connect
  // payloads across the fleet; it must not open the one endpoint that returns
  // credentials rather than ids and states.
  it('rejects the shared service token', async () => {
    const res = await gatewayDesiredConnections(buildContext('Bearer shared-service-token'));

    expect(res.status).toBe(401);
    expect(mockListDesired).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', undefined],
    ['wrong', 'Bearer nope'],
  ])('returns 401 on a %s credential', async (_label, authHeader) => {
    const res = await gatewayDesiredConnections(buildContext(authHeader));

    expect(res.status).toBe(401);
    expect(mockListDesired).not.toHaveBeenCalled();
  });

  // An empty list would tell the caller "hold nothing" and stop its retry.
  // "I do not route to you yet" is a different statement and has to stay
  // retryable, or a gateway that boots before its URL is configured never
  // recovers.
  it('returns a retryable 503 for a host this deployment does not route to', async () => {
    hostConfigured.value = false;

    const res = await gatewayDesiredConnections(buildContext(PULL));

    expect(res.status).toBe(503);
    expect(mockListDesired).not.toHaveBeenCalled();
  });

  // Nothing the caller writes picks the host. The credential does.
  it('serves the slice belonging to the credential that was presented', async () => {
    const payload = {
      complete: true,
      connections: [{ config: { connectionId: 'prov-1' }, ensure: true }],
      deferred: 0,
      excluded: 2,
    };
    mockListDesired.mockResolvedValue(payload);

    const res = await gatewayDesiredConnections(buildContext(PULL));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(payload);
    expect(mockListDesired).toHaveBeenCalledWith('node');
  });
});
