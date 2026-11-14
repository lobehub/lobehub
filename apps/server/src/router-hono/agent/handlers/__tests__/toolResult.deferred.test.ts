// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { toolResult } from '../toolResult';

const { mockAsyncShellEnabled } = vi.hoisted(() => ({ mockAsyncShellEnabled: { value: true } }));

const mockCompleteDeferredShell = vi.fn(async () => ({ handled: true, resumed: true } as any));
const mockResolveOwner = vi.fn(async () => ({ userId: 'user_1' }));
const mockPipeline = vi.fn();
const mockRedis = { pipeline: mockPipeline } as any;

vi.mock('@/server/modules/AgentRuntime/asyncShellPark', () => ({
  isAsyncShellEnabled: () => mockAsyncShellEnabled.value,
}));

vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: () => mockRedis,
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: async () => ({}) as any,
}));

vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: class {
    completeDeferredShell = mockCompleteDeferredShell;
  },
}));

vi.mock('../resolveOperationOwner', () => ({
  resolveOperationOwner: () => mockResolveOwner(),
}));

function buildContext(body: unknown) {
  return {
    json: (b: any, status = 200) => Response.json(b, { status }),
    req: { json: async () => body },
  } as any;
}

const deferredBody = {
  content: 'Command completed successfully.',
  deferred: true,
  operationId: 'op_1',
  state: { exitCode: 0 },
  success: true,
  toolCallId: 'call_1',
};

describe('toolResult handler — deferred delivery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAsyncShellEnabled.value = true;
  });

  it('routes a deferred result to the park completion, never to Redis', async () => {
    const res = await toolResult(buildContext(deferredBody));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ handled: true, resumed: true });
    expect(mockCompleteDeferredShell).toHaveBeenCalledWith({
      operationId: 'op_1',
      result: expect.objectContaining({
        state: { exitCode: 0 },
        success: true,
        toolCallId: 'call_1',
      }),
    });
    // The operation is parked: there is no BLPOP waiter to wake, and queueing
    // it would leave the row unfulfilled and the run stranded.
    expect(mockPipeline).not.toHaveBeenCalled();
  });

  it('rejects a deferred result with no operation to resume', async () => {
    const { operationId: _omitted, ...body } = deferredBody;
    const res = await toolResult(buildContext(body));

    expect(res.status).toBe(400);
    expect(mockCompleteDeferredShell).not.toHaveBeenCalled();
  });

  it('rejects so the gateway redelivers a completion that beat its placeholder', async () => {
    // The device sends a deferred result exactly once: a 200 here would discard
    // the only copy of a command that already finished.
    mockCompleteDeferredShell.mockResolvedValueOnce({
      handled: false,
      reason: 'placeholder_missing',
    });

    const res = await toolResult(buildContext(deferredBody));

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({
      error: 'Deferred shell placeholder is not ready',
      retryable: true,
    });
  });

  it('still acknowledges a foreign result when the async shell feature is off', async () => {
    // No park means no placeholder will ever appear; retrying every background
    // shell forever would be worse than the old acknowledgement.
    mockAsyncShellEnabled.value = false;
    mockCompleteDeferredShell.mockResolvedValueOnce({
      handled: false,
      reason: 'placeholder_missing',
    });

    const res = await toolResult(buildContext(deferredBody));

    expect(res.status).toBe(200);
  });

  it('returns 500 so the gateway can redeliver when completion throws', async () => {
    mockCompleteDeferredShell.mockRejectedValueOnce(new Error('backfill failed'));
    const res = await toolResult(buildContext(deferredBody));

    expect(res.status).toBe(500);
  });
});
