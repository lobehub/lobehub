// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { gatewayCallback } from '../gatewayCallback';

const { gatewayEnvState, mockUpdateBotRuntimeStatus } = vi.hoisted(() => ({
  gatewayEnvState: {} as {
    MESSAGE_GATEWAY_ENABLED?: string;
    MESSAGE_GATEWAY_SERVICE_TOKEN?: string;
  },
  mockUpdateBotRuntimeStatus: vi.fn(),
}));

vi.mock('@/envs/gateway', () => ({
  gatewayEnv: new Proxy(gatewayEnvState, {
    get: (target, prop: string) => target[prop as keyof typeof target],
  }),
}));

vi.mock('@/server/services/gateway/runtimeStatus', () => ({
  BOT_RUNTIME_STATUSES: {
    connected: 'connected',
    disconnected: 'disconnected',
    dormant: 'dormant',
    failed: 'failed',
    queued: 'queued',
    starting: 'starting',
  },
  updateBotRuntimeStatus: mockUpdateBotRuntimeStatus,
}));

function buildContext(opts: { authHeader?: string; body?: unknown; jsonThrows?: boolean }) {
  const captures: Array<{ body: any; status: number }> = [];
  const ctx = {
    body: (b: any, status: number) => {
      captures.push({ body: b, status });
      return new Response(b, { status });
    },
    json: (b: any, status = 200) => {
      captures.push({ body: b, status });
      return Response.json(b, { status });
    },
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
  return { ctx, getCaptures: () => captures };
}

const validBody = {
  applicationId: 'app-1',
  connectionId: 'conn-1',
  platform: 'discord',
  state: { status: 'connected' },
};

describe('gatewayCallback handler', () => {
  beforeEach(() => {
    mockUpdateBotRuntimeStatus.mockReset();
    gatewayEnvState.MESSAGE_GATEWAY_ENABLED = '1';
    gatewayEnvState.MESSAGE_GATEWAY_SERVICE_TOKEN = 'token-xyz';
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns 204 when MESSAGE_GATEWAY_ENABLED is not "1"', async () => {
    gatewayEnvState.MESSAGE_GATEWAY_ENABLED = '0';

    const { ctx, getCaptures } = buildContext({ authHeader: 'Bearer wrong', body: validBody });
    const res = await gatewayCallback(ctx);

    expect(res.status).toBe(204);
    expect(getCaptures()[0]).toEqual({ body: null, status: 204 });
    expect(mockUpdateBotRuntimeStatus).not.toHaveBeenCalled();
  });

  it('returns 503 when service token is unset', async () => {
    gatewayEnvState.MESSAGE_GATEWAY_SERVICE_TOKEN = undefined;
    const { ctx } = buildContext({ authHeader: 'Bearer x', body: validBody });
    const res = await gatewayCallback(ctx);
    expect(res.status).toBe(503);
  });

  it('returns 401 on bearer mismatch', async () => {
    const { ctx } = buildContext({ authHeader: 'Bearer wrong', body: validBody });
    const res = await gatewayCallback(ctx);
    expect(res.status).toBe(401);
  });

  it('returns 400 on JSON parse failure', async () => {
    const { ctx } = buildContext({ authHeader: 'Bearer token-xyz', jsonThrows: true });
    const res = await gatewayCallback(ctx);
    expect(res.status).toBe(400);
  });

  it('returns 400 on zod validation failure (missing connectionId)', async () => {
    const { ctx, getCaptures } = buildContext({
      authHeader: 'Bearer token-xyz',
      body: { ...validBody, connectionId: undefined },
    });
    const res = await gatewayCallback(ctx);
    expect(res.status).toBe(400);
    expect(getCaptures()[0].body.error).toBe('Invalid body');
  });

  it('returns 204 silently when applicationId is missing (no status update)', async () => {
    const { ctx } = buildContext({
      authHeader: 'Bearer token-xyz',
      body: { ...validBody, applicationId: undefined },
    });
    const res = await gatewayCallback(ctx);
    expect(res.status).toBe(204);
    expect(mockUpdateBotRuntimeStatus).not.toHaveBeenCalled();
  });

  it('returns 204 without writing status when state is "connecting"', async () => {
    const { ctx } = buildContext({
      authHeader: 'Bearer token-xyz',
      body: { ...validBody, state: { status: 'connecting' } },
    });
    const res = await gatewayCallback(ctx);
    expect(res.status).toBe(204);
    expect(mockUpdateBotRuntimeStatus).not.toHaveBeenCalled();
  });

  it.each([
    ['connected', 'connected'],
    ['disconnected', 'disconnected'],
    ['dormant', 'dormant'],
    ['error', 'failed'],
  ])('maps state.status=%s to runtimeStatus=%s and writes once', async (incoming, expected) => {
    mockUpdateBotRuntimeStatus.mockResolvedValue(undefined);
    const { ctx } = buildContext({
      authHeader: 'Bearer token-xyz',
      body: {
        ...validBody,
        state: { error: 'oops', status: incoming },
      },
    });

    const res = await gatewayCallback(ctx);

    expect(res.status).toBe(204);
    expect(mockUpdateBotRuntimeStatus).toHaveBeenCalledTimes(1);
    expect(mockUpdateBotRuntimeStatus).toHaveBeenCalledWith({
      applicationId: 'app-1',
      errorMessage: 'oops',
      platform: 'discord',
      status: expected,
    });
  });
});
