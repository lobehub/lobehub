import type { ChatToolPayload } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { dispatchClientTool } from '../dispatchClientTool';
import { AgentStepTimeoutError } from '../stepDeadline';
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
      assistantMessageId: 'msg-assistant',
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
      agentId: 'agent-1',
      assistantMessageId: 'msg-assistant',
      documentId: 'doc-1',
      groupId: 'group-1',
      operationId: 'op-1',
      rootOperationId: 'op-root',
      scope: 'thread',
      sourceMessageId: 'msg-user',
      streamManager,
      taskId: 'task-1',
      threadId: 'thread-1',
      topicId: 'topic-1',
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
      agentId: 'agent-1',
      assistantMessageId: 'msg-assistant',
      documentId: 'doc-1',
      groupId: 'group-1',
      operationId: 'op-1',
      rootOperationId: 'op-root',
      scope: 'thread',
      sourceMessageId: 'msg-user',
      streamManager,
      taskId: 'task-1',
      threadId: 'thread-1',
      topicId: 'topic-1',
    });

    expect(sendToolExecute).toHaveBeenCalledTimes(1);
    const sendCall = sendToolExecute.mock.calls[0];
    expect(sendCall[0]).toBe('op-1');
    expect(sendCall[1]).toMatchObject({
      apiName: 'readFile',
      agentId: 'agent-1',
      assistantMessageId: 'msg-assistant',
      documentId: 'doc-1',
      groupId: 'group-1',
      identifier: 'local-system',
      rootOperationId: 'op-root',
      scope: 'thread',
      sourceMessageId: 'msg-user',
      taskId: 'task-1',
      threadId: 'thread-1',
      toolCallId: 'call-1',
      topicId: 'topic-1',
    });

    expect(result.success).toBe(true);
    expect(result.content).toBe('file contents');
    expect(result.error).toBeUndefined();
    expect(mockDisconnect).toHaveBeenCalled();
  });

  it('forwards pluginState (state field) from the BLPOP payload to the execution result', async () => {
    const sendToolExecute = vi.fn().mockResolvedValue(undefined);
    const streamManager = makeStreamManager(sendToolExecute);

    const state = { cursor: 7, mode: 'preview' };
    mockBlpop.mockResolvedValue([
      'tool_result:call-1',
      JSON.stringify({
        content: 'file contents',
        state,
        success: true,
        toolCallId: 'call-1',
      }),
    ]);

    const result = await dispatchClientTool(makePayload(), {
      operationId: 'op-1',
      streamManager,
    });

    expect(result.state).toEqual(state);
  });

  it('forwards workRegistration from the BLPOP payload onto the execution result', async () => {
    const sendToolExecute = vi.fn().mockResolvedValue(undefined);
    const streamManager = makeStreamManager(sendToolExecute);

    const workRegistration = {
      action: 'create',
      targets: [{ taskId: 'task-9' }],
      type: 'task',
    };
    mockBlpop.mockResolvedValue([
      'tool_result:call-1',
      JSON.stringify({
        content: 'created',
        success: true,
        toolCallId: 'call-1',
        workRegistration,
      }),
    ]);

    const result = await dispatchClientTool(makePayload(), {
      operationId: 'op-1',
      streamManager,
    });

    expect(result.workRegistration).toEqual(workRegistration);
  });

  it('leaves workRegistration undefined when the BLPOP payload omits it', async () => {
    const sendToolExecute = vi.fn().mockResolvedValue(undefined);
    const streamManager = makeStreamManager(sendToolExecute);

    mockBlpop.mockResolvedValue([
      'tool_result:call-1',
      JSON.stringify({ content: 'ok', success: true, toolCallId: 'call-1' }),
    ]);

    const result = await dispatchClientTool(makePayload(), {
      operationId: 'op-1',
      streamManager,
    });

    expect(result.workRegistration).toBeUndefined();
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

  it('forwards the caller-provided timeoutMs to both sendToolExecute and waitForResult', async () => {
    const sendToolExecute = vi.fn().mockResolvedValue(undefined);
    const streamManager = makeStreamManager(sendToolExecute);

    mockBlpop.mockResolvedValue([
      'tool_result:call-1',
      JSON.stringify({ content: 'ok', success: true, toolCallId: 'call-1' }),
    ]);

    await dispatchClientTool(makePayload(), {
      operationId: 'op-1',
      streamManager,
      timeoutMs: 240_000,
    });

    expect(sendToolExecute.mock.calls[0][1]).toMatchObject({ executionTimeoutMs: 240_000 });
    // BLPOP signature: (key1, ..., timeoutSeconds). 240_000ms → 240s.
    const blpopArgs = mockBlpop.mock.calls[0];
    expect(blpopArgs.at(-1)).toBe(240);
  });

  it('clamps caller-supplied timeoutMs above the MAX_TIMEOUT_MS ceiling', async () => {
    const sendToolExecute = vi.fn().mockResolvedValue(undefined);
    const streamManager = makeStreamManager(sendToolExecute);

    mockBlpop.mockResolvedValue([
      'tool_result:call-1',
      JSON.stringify({ content: 'ok', success: true, toolCallId: 'call-1' }),
    ]);

    await dispatchClientTool(makePayload(), {
      operationId: 'op-1',
      streamManager,
      timeoutMs: 10_000_000,
    });

    expect(sendToolExecute.mock.calls[0][1]).toMatchObject({ executionTimeoutMs: 480_000 });
  });

  it('falls back to the 120s global default when ctx.timeoutMs is omitted', async () => {
    const sendToolExecute = vi.fn().mockResolvedValue(undefined);
    const streamManager = makeStreamManager(sendToolExecute);

    mockBlpop.mockResolvedValue([
      'tool_result:call-1',
      JSON.stringify({ content: 'ok', success: true, toolCallId: 'call-1' }),
    ]);

    await dispatchClientTool(makePayload(), {
      operationId: 'op-1',
      streamManager,
    });

    expect(sendToolExecute.mock.calls[0][1]).toMatchObject({ executionTimeoutMs: 120_000 });
  });

  it('stops a client-tool Redis wait when the containing step is aborted', async () => {
    const sendToolExecute = vi.fn().mockResolvedValue(undefined);
    const streamManager = makeStreamManager(sendToolExecute);
    const controller = new AbortController();
    mockBlpop.mockImplementation(() => new Promise(() => {}));

    const resultPromise = dispatchClientTool(makePayload(), {
      operationId: 'op-1',
      signal: controller.signal,
      streamManager,
    });
    await vi.waitFor(() => expect(mockBlpop).toHaveBeenCalled());
    const timeoutError = new AgentStepTimeoutError({
      deadlineAt: Date.now(),
      stage: 'tool.client.wait',
    });
    controller.abort(timeoutError);

    await expect(resultPromise).rejects.toBe(timeoutError);
    expect(mockDisconnect).toHaveBeenCalled();
  });
});
