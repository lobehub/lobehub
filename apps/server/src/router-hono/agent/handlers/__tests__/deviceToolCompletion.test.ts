// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { deviceToolCompletion } from '../deviceToolCompletion';

const mockCompleteDeferredShell = vi.fn(async () => ({ handled: true, resumed: true }) as any);
const mockResolveOwner = vi.fn(async () => ({ userId: 'user_1' }) as any);

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

const completion = {
  deviceId: 'device_1',
  operationId: 'op_1',
  result: {
    content: 'Command completed successfully.',
    state: { exitCode: 0, running: false },
    success: true,
  },
  toolCallId: 'call_1',
  userId: 'user_1',
};

describe('deviceToolCompletion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resumes the parked operation with the device result', async () => {
    const res = await deviceToolCompletion(buildContext(completion));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ handled: true, resumed: true });
    expect(mockCompleteDeferredShell).toHaveBeenCalledWith({
      operationId: 'op_1',
      result: expect.objectContaining({
        content: 'Command completed successfully.',
        state: { exitCode: 0, running: false },
        success: true,
        toolCallId: 'call_1',
      }),
    });
  });

  it('normalizes a device error string into a tool error', async () => {
    await deviceToolCompletion(
      buildContext({
        ...completion,
        result: { content: 'shell_id not found', error: 'NOT_FOUND', success: false },
      }),
    );

    expect(mockCompleteDeferredShell).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({
          error: { message: 'NOT_FOUND', type: 'device_error' },
          success: false,
        }),
      }),
    );
  });

  it('refuses a completion from another account', async () => {
    const res = await deviceToolCompletion(buildContext({ ...completion, userId: 'user_2' }));

    // 4xx → the gateway answers `rejected` and the device stops resending.
    expect(res.status).toBe(403);
    expect(mockCompleteDeferredShell).not.toHaveBeenCalled();
  });

  it('matches a workspace device against the run workspace', async () => {
    mockResolveOwner.mockResolvedValueOnce({ userId: 'user_9', workspaceId: 'ws_1' });

    const res = await deviceToolCompletion(
      buildContext({ ...completion, userId: undefined, workspaceId: 'ws_1' }),
    );

    expect(res.status).toBe(200);
    expect(mockCompleteDeferredShell).toHaveBeenCalled();
  });

  it('refuses a workspace device for a run in another workspace', async () => {
    mockResolveOwner.mockResolvedValueOnce({ userId: 'user_1', workspaceId: 'ws_other' });

    const res = await deviceToolCompletion(
      buildContext({ ...completion, userId: undefined, workspaceId: 'ws_1' }),
    );

    expect(res.status).toBe(403);
    expect(mockCompleteDeferredShell).not.toHaveBeenCalled();
  });

  it('asks for a resend while the placeholder is not written yet', async () => {
    mockCompleteDeferredShell.mockResolvedValueOnce({
      handled: false,
      reason: 'placeholder_missing',
    });

    const res = await deviceToolCompletion(buildContext(completion));

    // 5xx → the gateway answers `retry`; acknowledging would drop the only copy.
    expect(res.status).toBe(503);
  });

  it('acknowledges a completion for a call that was never parked', async () => {
    mockCompleteDeferredShell.mockResolvedValueOnce({
      handled: false,
      reason: 'not_deferred_shell',
    });

    const res = await deviceToolCompletion(buildContext(completion));

    expect(res.status).toBe(200);
  });

  it('answers 404 for an unknown operation', async () => {
    mockResolveOwner.mockResolvedValueOnce(undefined);

    const res = await deviceToolCompletion(buildContext(completion));

    expect(res.status).toBe(404);
  });

  it('rejects a malformed body', async () => {
    const res = await deviceToolCompletion(buildContext({ operationId: 'op_1' }));

    expect(res.status).toBe(400);
  });

  it('lets the device retry when delivery throws', async () => {
    mockCompleteDeferredShell.mockRejectedValueOnce(new Error('db down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await deviceToolCompletion(buildContext(completion));

    expect(res.status).toBe(500);
  });
});
