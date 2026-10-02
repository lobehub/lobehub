import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createStreamEventManagerMock,
  drainPushesMock,
  subscribeStreamEventsMock,
  executeSyncMock,
  execAgentMock,
} = vi.hoisted(() => ({
  createStreamEventManagerMock: vi.fn(),
  drainPushesMock: vi.fn(),
  subscribeStreamEventsMock: vi.fn(),
  executeSyncMock: vi.fn(),
  execAgentMock: vi.fn(),
}));

vi.mock('@/server/modules/AgentRuntime/factory', () => ({
  createStreamEventManager: createStreamEventManagerMock,
}));
vi.mock('@/server/services/agentRuntime', () => ({
  AgentRuntimeService: class {
    executeSync = executeSyncMock;
  },
}));
vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: class {
    execAgent = execAgentMock;
  },
}));
vi.mock('../../common/base.service', () => ({
  BaseService: class {
    db: any = null;
    userId = 'user_1';
    workspaceId = 'ws_1';
    constructor() {}
    log() {}
  },
}));

import { ResponsesService } from '../responses.service';

const collect = async (gen: AsyncGenerator<any>) => {
  const out: any[] = [];
  for await (const event of gen) out.push(event);
  return out;
};

describe('ResponsesService.createStreamingResponse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    drainPushesMock.mockResolvedValue(undefined);
    execAgentMock.mockResolvedValue({ operationId: 'op_1', success: true, topicId: 'tpc_1' });
    createStreamEventManagerMock.mockReturnValue({
      drainPushes: drainPushesMock,
      subscribeStreamEvents: subscribeStreamEventsMock,
    });
  });

  it('runs the operation on the shared stream manager and flushes its gateway pushes', async () => {
    let onEvents: ((events: any[]) => void) | undefined;
    subscribeStreamEventsMock.mockImplementation(
      async (_operationId: string, _lastEventId: string, cb: (events: any[]) => void) => {
        onEvents = cb;
      },
    );
    executeSyncMock.mockImplementation(async () => {
      onEvents?.([
        {
          data: { chunkType: 'text', content: 'hi' },
          stepIndex: 0,
          timestamp: Date.now(),
          type: 'stream_chunk',
        },
      ]);
      return { messages: [], status: 'done', stepCount: 1 };
    });

    const svc = new (ResponsesService as any)(null, 'user_1', { workspaceId: 'ws_1' });
    const events = await collect(
      (svc as any).createStreamingResponse({ input: 'hello', model: 'agt_1' }),
    );

    // Regression: the run must execute on the gateway-aware shared manager. A
    // private in-memory manager left the operation registered with the gateway
    // DO but never mirrored its terminal event, so the DO's inactivity watchdog
    // abandoned the already-finished run ~10min later.
    expect(createStreamEventManagerMock).toHaveBeenCalledTimes(1);
    expect(subscribeStreamEventsMock).toHaveBeenCalledWith(
      'op_1',
      '0',
      expect.any(Function),
      expect.any(AbortSignal),
    );

    // Streaming still works end to end.
    const deltas = events.filter((event) => event.type === 'response.output_text.delta');
    expect(deltas.map((delta) => delta.delta)).toEqual(['hi']);
    expect(events.at(-1)?.type).toBe('response.completed');

    // The terminal push has to land before the invocation can be frozen.
    expect(drainPushesMock).toHaveBeenCalledWith('op_1');
  });
});
