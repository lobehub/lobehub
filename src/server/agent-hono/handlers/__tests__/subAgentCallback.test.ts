// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { subAgentCallback } from '../subAgentCallback';

const mockCompleteSubAgentBridge = vi.fn();
const mockGetOperationMetadata = vi.fn();
const mockAiAgentService = vi.fn();

vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn().mockImplementation((...args: any[]) => {
    mockAiAgentService(...args);
    return { completeSubAgentBridge: mockCompleteSubAgentBridge };
  }),
}));

vi.mock('@/server/modules/AgentRuntime', () => ({
  AgentRuntimeCoordinator: vi.fn().mockImplementation(() => ({
    getOperationMetadata: mockGetOperationMetadata,
  })),
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn().mockResolvedValue({} as any),
}));

function buildContext(opts: { body?: unknown; jsonThrows?: boolean }) {
  const captures: Array<{ body: any; status: number }> = [];
  const ctx = {
    json: (b: any, status = 200) => {
      captures.push({ body: b, status });
      return Response.json(b, { status });
    },
    req: {
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
  operationId: 'op-child-1',
  parentOperationId: 'op-parent-1',
  reason: 'done',
  threadId: 'thread-1',
  toolMessageId: 'msg-tool-1',
};

describe('subAgentCallback handler', () => {
  beforeEach(() => {
    mockCompleteSubAgentBridge.mockReset();
    mockGetOperationMetadata.mockReset();
    mockAiAgentService.mockReset();
    mockGetOperationMetadata.mockResolvedValue({ userId: 'user-1', workspaceId: 'ws-1' });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 when JSON parsing throws', async () => {
    const { ctx } = buildContext({ jsonThrows: true });
    const res = await subAgentCallback(ctx);
    expect(res.status).toBe(400);
    expect(mockCompleteSubAgentBridge).not.toHaveBeenCalled();
  });

  it.each([
    ['operationId', { ...validBody, operationId: undefined }],
    ['parentOperationId', { ...validBody, parentOperationId: undefined }],
    ['toolMessageId', { ...validBody, toolMessageId: undefined }],
  ])('returns 400 when required field %s is missing', async (_field, body) => {
    const { ctx, getCaptures } = buildContext({ body });
    const res = await subAgentCallback(ctx);
    expect(res.status).toBe(400);
    expect(getCaptures()[0].body.error).toMatch(/Missing required fields/);
    expect(mockCompleteSubAgentBridge).not.toHaveBeenCalled();
  });

  it('returns 401 when the child operation has no userId', async () => {
    mockGetOperationMetadata.mockResolvedValue(undefined);
    const { ctx } = buildContext({ body: validBody });

    const res = await subAgentCallback(ctx);

    expect(res.status).toBe(401);
    expect(mockCompleteSubAgentBridge).not.toHaveBeenCalled();
  });

  it('runs the bridge and returns 200 on happy path', async () => {
    mockCompleteSubAgentBridge.mockResolvedValue(true);
    const { ctx, getCaptures } = buildContext({ body: validBody });

    const res = await subAgentCallback(ctx);

    expect(res.status).toBe(200);
    expect(getCaptures()[0].body).toEqual({
      operationId: 'op-child-1',
      parentOperationId: 'op-parent-1',
      resumed: true,
      success: true,
    });
    expect(mockCompleteSubAgentBridge).toHaveBeenCalledWith({
      operationId: 'op-child-1',
      parentOperationId: 'op-parent-1',
      reason: 'done',
      threadId: 'thread-1',
      toolMessageId: 'msg-tool-1',
    });
    // Workspace-scoped like the /run step worker — a personal-scoped runtime
    // would miss workspace rows in the backfill / barrier queries.
    expect(mockAiAgentService).toHaveBeenCalledWith(expect.anything(), 'user-1', {
      workspaceId: 'ws-1',
    });
  });

  it('defaults reason to done and threadId to empty string when absent', async () => {
    mockCompleteSubAgentBridge.mockResolvedValue(false);
    const { ctx } = buildContext({
      body: { ...validBody, reason: undefined, threadId: undefined },
    });

    const res = await subAgentCallback(ctx);

    expect(res.status).toBe(200);
    expect(mockCompleteSubAgentBridge).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'done', threadId: '' }),
    );
  });

  it('returns 500 with the error message when the bridge throws (QStash redelivers)', async () => {
    mockCompleteSubAgentBridge.mockRejectedValue(new Error('redis down'));
    const { ctx, getCaptures } = buildContext({ body: validBody });

    const res = await subAgentCallback(ctx);

    expect(res.status).toBe(500);
    expect(getCaptures()[0].body).toEqual({ error: 'redis down' });
  });
});
