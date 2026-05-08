import type { ChatToolPayload } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { dispatchClientTool } from '../dispatchClientTool';
import type { IStreamEventManager } from '../types';

// Mock Redis before importing the SUT so the module-level getter sees it.
const mockBlpop = vi.fn();
const mockDisconnect = vi.fn();
const mockDuplicate = vi.fn();
let currentRedis: any;

vi.mock('../redis', () => ({
  getAgentRuntimeRedisClient: () => currentRedis,
}));

function makePayload(overrides: Partial<ChatToolPayload> = {}): ChatToolPayload {
  return {
    apiName: 'readFile',
    arguments: '{"path":"/tmp/x"}',
    executor: 'client',
    id: 'call-1',
    identifier: 'local-system',
    type: 'default' as any,
    ...overrides,
  };
}

function makeStreamManager(
  sendToolExecute?: IStreamEventManager['sendToolExecute'],
): IStreamEventManager {
  return {
    cleanupOperation: vi.fn(),
    disconnect: vi.fn(),
    getActiveOperationsCount: vi.fn(),
    getStreamHistory: vi.fn(),
    publishAgentRuntimeEnd: vi.fn(),
    publishAgentRuntimeInit: vi.fn(),
    publishStreamChunk: vi.fn(),
    publishStreamEvent: vi.fn(),
    sendToolExecute,
    subscribeStreamEvents: vi.fn(),
  } as unknown as IStreamEventManager;
}

describe('dispatchClientTool', () => {
  beforeEach(() => {
    mockBlpop.mockReset();
    mockDisconnect.mockReset();
    mockDuplicate.mockReset();

    const blockingClient = {
      blpop: mockBlpop,
      disconnect: mockDisconnect,
    };
    mockDuplicate.mockReturnValue(blockingClient);

    currentRedis = {
      duplicate: mockDuplicate,
      pipeline: vi.fn(() => ({
        exec: vi.fn().mockResolvedValue([]),
        expire: vi.fn().mockReturnThis(),
        lpush: vi.fn().mockReturnThis(),
      })),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns gateway_unsupported when streamManager.sendToolExecute is missing', async () => {
    const streamManager = makeStreamManager(undefined);

    const result = await dispatchClientTool(makePayload(), {
      operationId: 'op-1',
      streamManager,
    });

    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('gateway_unsupported');
    expect(mockDuplicate).not.toHaveBeenCalled();
  });

  it('returns redis_unavailable when Redis is not configured', async () => {
    currentRedis = null;
    const streamManager = makeStreamManager(vi.fn());

    const result = await dispatchClientTool(makePayload(), {
      operationId: 'op-1',
      streamManager,
    });

    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('redis_unavailable');
  });

  it('sends tool_execute, BLPOPs, and returns the parsed result on success', async () => {
    const sendToolExecute = vi.fn().mockResolvedValue(undefined);
    const streamManager = makeStreamManager(sendToolExecute);

    mockBlpop.mockResolvedValue([
      'tool_result:call-1',
      JSON.stringify({
        content: 'file contents',
        success: true,
        toolCallId: 'call-1',
      }),
    ]);

    const result = await dispatchClientTool(makePayload(), {
      operationId: 'op-1',
      streamManager,
    });

    expect(sendToolExecute).toHaveBeenCalledTimes(1);
    const sendCall = sendToolExecute.mock.calls[0];
    expect(sendCall[0]).toBe('op-1');
    expect(sendCall[1]).toMatchObject({
      apiName: 'readFile',
      identifier: 'local-system',
      toolCallId: 'call-1',
    });

    expect(result.success).toBe(true);
    expect(result.content).toBe('file contents');
    expect(result.error).toBeUndefined();
    expect(mockDisconnect).toHaveBeenCalled();
  });

  it('returns a timeout result and still disconnects when BLPOP times out', async () => {
    const sendToolExecute = vi.fn().mockResolvedValue(undefined);
    const streamManager = makeStreamManager(sendToolExecute);

    mockBlpop.mockResolvedValue(null);

    const result = await dispatchClientTool(makePayload(), {
      operationId: 'op-1',
      streamManager,
    });

    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('timeout');
    expect(mockDisconnect).toHaveBeenCalled();
  });

  it('returns a dispatch_failed result when sendToolExecute rejects', async () => {
    const sendToolExecute = vi.fn().mockRejectedValue(new Error('gateway down'));
    const streamManager = makeStreamManager(sendToolExecute);

    const result = await dispatchClientTool(makePayload(), {
      operationId: 'op-1',
      streamManager,
    });

    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('dispatch_failed');
    expect(result.error?.message).toBe('gateway down');
    expect(mockDisconnect).toHaveBeenCalled();
  });
});
