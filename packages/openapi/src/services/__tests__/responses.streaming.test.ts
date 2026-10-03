import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createStreamEventManagerMock, drainPushesMock, executeSyncMock, execAgentMock } = vi.hoisted(
  () => ({
    createStreamEventManagerMock: vi.fn(),
    drainPushesMock: vi.fn(),
    executeSyncMock: vi.fn(),
    execAgentMock: vi.fn(),
  }),
);

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

import { InMemoryStreamEventManager } from '@/server/modules/AgentRuntime/InMemoryStreamEventManager';

import { ResponsesService } from '../responses.service';

const buildService = () => new (ResponsesService as any)(null, 'user_1', { workspaceId: 'ws_1' });

/** The private in-memory manager the service took from the factory. */
const subscribedManager = (): InMemoryStreamEventManager =>
  createStreamEventManagerMock.mock.calls[0][0].inner;

const remainingSubscribers = (manager: InMemoryStreamEventManager, operationId: string): number =>
  ((manager as any).subscribers.get(operationId) ?? []).length;

/** Publish one text chunk through the manager, standing in for the runtime. */
const publishChunk = async (operationId: string, content: string) => {
  await subscribedManager().publishStreamChunk(operationId, 0, { chunkType: 'text', content });
};

describe('ResponsesService.createStreamingResponse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    drainPushesMock.mockResolvedValue(undefined);
    execAgentMock.mockResolvedValue({ operationId: 'op_1', success: true, topicId: 'tpc_1' });
    createStreamEventManagerMock.mockReturnValue({ drainPushes: drainPushesMock });
  });

  it('mirrors the run to the gateway while streaming from a private in-memory manager', async () => {
    executeSyncMock.mockImplementation(async () => {
      await publishChunk('op_1', 'hi');
      return { messages: [], status: 'done', stepCount: 1 };
    });

    const events: any[] = [];
    for await (const event of buildService().createStreamingResponse({
      input: 'hello',
      model: 'agt_1',
    })) {
      events.push(event);
    }

    // Regression: `execAgent` registers the operation with the gateway DO, which
    // only closes the session on an `agent_runtime_end`. Running the operation
    // on a manager nothing mirrors left the DO holding a finished run as
    // `running` until its inactivity watchdog abandoned it.
    expect(createStreamEventManagerMock).toHaveBeenCalledTimes(1);
    expect(subscribedManager()).toBeInstanceOf(InMemoryStreamEventManager);

    // Streaming still works end to end, from the in-process manager.
    const deltas = events.filter((event) => event.type === 'response.output_text.delta');
    expect(deltas.map((delta) => delta.delta)).toEqual(['hi']);
    expect(events.at(-1)?.type).toBe('response.completed');

    // The terminal push has to land before the invocation can be frozen.
    expect(drainPushesMock).toHaveBeenCalledWith('op_1');
    // …and the subscription is released with it.
    expect(remainingSubscribers(subscribedManager(), 'op_1')).toBe(0);
  });

  it('releases the subscription and drains pushes when the client disconnects mid-stream', async () => {
    executeSyncMock.mockImplementation(async () => {
      await publishChunk('op_1', 'hi');
      // The run never finishes: the client drops mid-stream instead.
      await new Promise(() => {});
      return { messages: [], status: 'done', stepCount: 1 };
    });

    const generator = buildService().createStreamingResponse({
      input: 'hello',
      model: 'agt_1',
    });

    // Consume up to the first streamed token, then close the generator the way
    // the controller does when its `for await` is abandoned.
    const seen: string[] = [];
    for (let step = 0; step < 10; step += 1) {
      const { done, value } = await generator.next();
      if (done) break;
      seen.push(value.type);
      if (value.type === 'response.output_text.delta') break;
    }
    expect(seen).toContain('response.output_text.delta');

    await generator.return(undefined);

    expect(drainPushesMock).toHaveBeenCalledWith('op_1');
    expect(remainingSubscribers(subscribedManager(), 'op_1')).toBe(0);
  });
});
