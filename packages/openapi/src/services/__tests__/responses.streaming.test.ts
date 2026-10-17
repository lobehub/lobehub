import { beforeEach, describe, expect, it, vi } from 'vitest';

import { InMemoryStreamEventManager } from '@/server/modules/AgentRuntime/InMemoryStreamEventManager';

import type * as ResumeModule from '../client-tool-resume.responses';
import { ResponsesService } from '../responses.service';

const {
  createStreamEventManagerMock,
  drainPushesMock,
  executeResponseRunMock,
  executeSyncMock,
  execAgentMock,
  resumeParkedClientToolsMock,
} = vi.hoisted(() => ({
  createStreamEventManagerMock: vi.fn(),
  drainPushesMock: vi.fn(),
  executeResponseRunMock: vi.fn(),
  executeSyncMock: vi.fn(),
  execAgentMock: vi.fn(),
  resumeParkedClientToolsMock: vi.fn(),
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
vi.mock('../client-tool-resume.responses', async (importOriginal) => {
  const actual = await importOriginal<typeof ResumeModule>();
  executeResponseRunMock.mockImplementation(actual.executeResponseRun);
  return {
    ...actual,
    executeResponseRun: executeResponseRunMock,
    resumeParkedClientTools: resumeParkedClientToolsMock,
  };
});
vi.mock('../../common/base.service', () => ({
  BaseService: class {
    db: any = null;
    userId = 'user_1';
    workspaceId = 'ws_1';
    constructor() {}
    log() {}
  },
}));

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
    // Must match `AgentRuntimeService`'s own setup: `deferPushes` keeps a
    // `stream_end` / `message_patch` step from blocking on its gateway HTTP
    // push, and the generator's `finally` drains what was deferred.
    expect(createStreamEventManagerMock).toHaveBeenCalledWith({
      deferPushes: true,
      inner: expect.any(InMemoryStreamEventManager),
    });
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

describe('ResponsesService function call outputs', () => {
  const toolOutputRequest = {
    input: [{ call_id: 'call_1', output: 'sunny', type: 'function_call_output' as const }],
    model: 'agt_1',
    previous_response_id: 'tpc_1',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    createStreamEventManagerMock.mockReturnValue({ drainPushes: drainPushesMock });
    resumeParkedClientToolsMock.mockResolvedValue({ operationId: 'op_parked' });
    executeResponseRunMock.mockResolvedValue({ messages: [], status: 'done', stepCount: 3 });
  });

  // Regression: the outputs started a second run on the topic, which the parked
  // run still held, so every resume failed as "Topic … remained busy".
  it('continues the run parked on the caller tools instead of starting another', async () => {
    const response = await buildService().createResponse(toolOutputRequest);

    expect(resumeParkedClientToolsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        outputs: toolOutputRequest.input,
        topicId: 'tpc_1',
        userId: 'user_1',
      }),
    );
    expect(execAgentMock).not.toHaveBeenCalled();
    expect(executeResponseRunMock).toHaveBeenCalledWith(expect.anything(), {
      operationId: 'op_parked',
      resumed: true,
      topicId: 'tpc_1',
    });
    expect(response).toMatchObject({ id: 'tpc_1', status: 'completed' });
  });

  it('streams the resumed run on the same response id', async () => {
    const events: any[] = [];
    for await (const event of buildService().createStreamingResponse(toolOutputRequest)) {
      events.push(event);
    }

    expect(execAgentMock).not.toHaveBeenCalled();
    expect(events[0]).toMatchObject({ response: { id: 'tpc_1' }, type: 'response.created' });
    expect(events.at(-1)?.type).toBe('response.completed');
    expect(drainPushesMock).toHaveBeenCalledWith('op_parked');
  });

  it('returns the parked call to a non-streaming caller', async () => {
    resumeParkedClientToolsMock.mockResolvedValue(undefined);
    execAgentMock.mockResolvedValue({ operationId: 'op_new', success: true, topicId: 'tpc_2' });
    executeResponseRunMock.mockResolvedValue({
      interruption: { reason: 'client_tool_execution' },
      messages: [],
      pendingToolsCalling: [
        {
          apiName: 'get_weather',
          arguments: '{"city":"Hangzhou"}',
          id: 'call_9',
          identifier: 'lobe-client-fn',
        },
      ],
      status: 'waiting_for_async_tool',
    });

    const response = await buildService().createResponse({ input: 'weather?', model: 'agt_1' });

    expect(response).toMatchObject({
      incomplete_details: { reason: 'client_tool_execution' },
      output: [{ call_id: 'call_9', name: 'get_weather', type: 'function_call' }],
      status: 'incomplete',
    });
  });

  it('falls back to a new turn when nothing is parked on the topic', async () => {
    resumeParkedClientToolsMock.mockResolvedValue(undefined);
    execAgentMock.mockResolvedValue({ operationId: 'op_new', success: true, topicId: 'tpc_1' });

    await buildService().createResponse(toolOutputRequest);

    expect(execAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        appContext: { topicId: 'tpc_1' },
        prompt: 'Tool call call_1 returned: sunny',
      }),
    );
  });
});
