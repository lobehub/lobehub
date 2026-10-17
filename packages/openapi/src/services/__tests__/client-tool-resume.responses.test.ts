import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ClientToolResumeError,
  executeResponseRun,
  parkedOnToolsReason,
  pendingFunctionCallItems,
  resumeParkedClientTools,
} from '../client-tool-resume.responses';

const db = vi.hoisted(() => ({
  createMessage: vi.fn(),
  findOperation: vi.fn(),
  findTopic: vi.fn(),
  findToolMessageId: vi.fn(),
  releaseClaim: vi.fn(),
  tryResume: vi.fn(),
  updateToolMessage: vi.fn(),
}));

vi.mock('@/database/models/topic', () => ({
  TopicModel: class {
    findById = db.findTopic;
  },
}));
vi.mock('@/database/models/agentOperation', () => ({
  AgentOperationModel: class {
    findById = db.findOperation;
    tryResumeFromAsyncTool = db.tryResume;
  },
}));
vi.mock('@/database/models/message', () => ({
  MessageModel: class {
    create = db.createMessage;
    findToolMessageIdByToolCallId = db.findToolMessageId;
    updateToolMessage = db.updateToolMessage;
  },
}));

const weatherCall = {
  apiName: 'get_weather',
  arguments: '{}',
  id: 'call_1',
  identifier: 'lobe-client-fn',
};
const subAgentCall = {
  apiName: 'callSubAgent',
  arguments: '{}',
  id: 'call_sub',
  identifier: 'lobe-agent',
};

const parkedState = () => ({
  messages: [
    { content: 'weather?', id: 'msg_user', role: 'user' },
    { content: '', id: 'msg_assistant', role: 'assistant', tool_calls: [{ id: 'call_1' }] },
  ],
  origin: { agentId: 'agt_1', topicId: 'tpc_1' },
  pendingToolsCalling: [weatherCall],
  status: 'waiting_for_async_tool',
  stepCount: 2,
});

const runtime = (state: unknown = parkedState()) => {
  const executeStep = vi.fn();
  const executeSync = vi.fn();
  const tryResumeParentFromAsyncTool = vi.fn();
  return {
    executeStep,
    executeSync,
    tryResumeParentFromAsyncTool,
    getCoordinator: () => ({ loadAgentState: vi.fn().mockResolvedValue(state) }),
  };
};

const resume = (agentRuntimeService: unknown, outputs = [{ call_id: 'call_1', output: 'sunny' }]) =>
  resumeParkedClientTools({
    agentRuntimeService: agentRuntimeService as any,
    // Only the claim release writes through the db directly.
    db: { update: () => ({ set: () => ({ where: db.releaseClaim }) }) } as any,
    outputs: outputs.map((item) => ({ ...item, type: 'function_call_output' as const })),
    topicId: 'tpc_1',
    userId: 'user_1',
  });

describe('resumeParkedClientTools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.findTopic.mockResolvedValue({
      metadata: { runningOperation: { operationId: 'op_parked' } },
    });
    db.findOperation.mockResolvedValue({
      agentId: 'agt_1',
      interruption: { reason: 'client_tool_execution' },
      status: 'waiting_for_async_tool',
    });
    db.findToolMessageId.mockResolvedValue(null);
    db.tryResume.mockResolvedValue(true);
  });

  it('answers the parked call with its output and claims the run', async () => {
    await expect(resume(runtime())).resolves.toEqual({
      callIds: ['call_1'],
      operationId: 'op_parked',
    });

    expect(db.createMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agt_1',
        content: 'sunny',
        parentId: 'msg_assistant',
        plugin: weatherCall,
        role: 'tool',
        tool_call_id: 'call_1',
        topicId: 'tpc_1',
      }),
    );
    expect(db.tryResume).toHaveBeenCalledWith('op_parked');
    // Claimed before anything is written, and kept: this request runs the resume.
    expect(db.tryResume.mock.invocationCallOrder[0]).toBeLessThan(
      db.createMessage.mock.invocationCallOrder[0],
    );
    expect(db.releaseClaim).not.toHaveBeenCalled();
  });

  // A parked state is saved without its messages.
  it('hangs the result off the last model call when the state has no messages', async () => {
    await resume(
      runtime({ ...parkedState(), messages: [], metadata: { workAssistantMessageId: 'msg_work' } }),
    );

    expect(db.createMessage).toHaveBeenCalledWith(
      expect.objectContaining({ parentId: 'msg_work' }),
    );
  });

  it('fills a result row that already exists instead of adding another', async () => {
    db.findToolMessageId.mockResolvedValue('msg_tool');

    await resume(runtime());

    expect(db.findToolMessageId).toHaveBeenCalledWith('call_1', 'msg_assistant');
    expect(db.updateToolMessage).toHaveBeenCalledWith('msg_tool', { content: 'sunny' });
    expect(db.createMessage).not.toHaveBeenCalled();
  });

  it('leaves topics without a run waiting on the caller to a new run', async () => {
    await expect(
      resume(runtime({ ...parkedState(), pendingToolsCalling: [subAgentCall] })),
    ).resolves.toBeUndefined();

    db.findOperation.mockResolvedValueOnce({ status: 'done' });
    await expect(resume(runtime())).resolves.toBeUndefined();

    db.findTopic.mockResolvedValueOnce({ metadata: {} });
    await expect(resume(runtime())).resolves.toBeUndefined();

    expect(db.createMessage).not.toHaveBeenCalled();
    expect(db.tryResume).not.toHaveBeenCalled();
  });

  it('rejects outputs that do not match the parked calls, before writing anything', async () => {
    await expect(resume(runtime(), [])).rejects.toThrow(
      new ClientToolResumeError('No tool output found for function call call_1.'),
    );
    await expect(
      resume(runtime(), [
        { call_id: 'call_1', output: 'sunny' },
        { call_id: 'call_x', output: '?' },
      ]),
    ).rejects.toThrow('No tool call found for function call output with call_id call_x.');

    expect(db.createMessage).not.toHaveBeenCalled();
    expect(db.tryResume).not.toHaveBeenCalled();
  });

  // Regression (review): a losing delivery wrote, or replaced, result rows
  // before it learned another one had already resumed the run.
  it('refuses a second delivery without writing anything', async () => {
    db.tryResume.mockResolvedValue(false);

    await expect(resume(runtime())).rejects.toThrow(ClientToolResumeError);
    expect(db.createMessage).not.toHaveBeenCalled();
    expect(db.updateToolMessage).not.toHaveBeenCalled();
  });

  it('hands the park back when writing a result fails', async () => {
    db.createMessage.mockRejectedValueOnce(new Error('db down'));

    await expect(resume(runtime())).rejects.toThrow('db down');
    expect(db.releaseClaim).toHaveBeenCalledTimes(1);
  });

  describe('a batch that also waits on server-side tools', () => {
    const mixed = () =>
      runtime({ ...parkedState(), pendingToolsCalling: [weatherCall, subAgentCall] });

    // Regression (review): such a park ("async_tool") was ignored, so the
    // outputs started a new run on the busy topic.
    it('saves the caller output and resumes once the other tools are done', async () => {
      const service = mixed();
      service.tryResumeParentFromAsyncTool.mockResolvedValue(true);

      await expect(resume(service)).resolves.toEqual({
        callIds: ['call_1'],
        operationId: 'op_parked',
      });
      expect(db.createMessage).toHaveBeenCalledTimes(1);
      expect(db.createMessage).toHaveBeenCalledWith(
        expect.objectContaining({ tool_call_id: 'call_1' }),
      );
      // Released to the runtime's barrier, which claimed it again for this request.
      expect(db.releaseClaim).toHaveBeenCalledTimes(1);
      expect(service.tryResumeParentFromAsyncTool).toHaveBeenCalledWith({
        parentOperationId: 'op_parked',
      });
    });

    it('holds the run for the other tools when they are still out', async () => {
      const service = mixed();
      service.tryResumeParentFromAsyncTool.mockResolvedValue(false);

      await expect(resume(service)).resolves.toEqual({
        callIds: ['call_1'],
        held: true,
        operationId: 'op_parked',
      });
    });

    it('does not take outputs for the server-side calls', async () => {
      await expect(
        resume(mixed(), [
          { call_id: 'call_1', output: 'sunny' },
          { call_id: 'call_sub', output: 'done' },
        ]),
      ).rejects.toThrow('No tool call found for function call output with call_id call_sub.');
    });
  });
});

describe('executeResponseRun', () => {
  it('takes the first step of a resumed run as the async-tool resume', async () => {
    const service = runtime();
    const nextContext = { phase: 'llm_result' };
    service.executeStep.mockResolvedValue({
      state: { status: 'running' },
      stepResult: { nextContext },
    });
    service.executeSync.mockResolvedValue({ status: 'done' });

    await expect(
      executeResponseRun(service as any, { operationId: 'op_parked', resumed: true }),
    ).resolves.toEqual({ status: 'done' });

    expect(service.executeStep).toHaveBeenCalledWith({
      operationId: 'op_parked',
      resumeAsyncTool: true,
      stepIndex: 2,
    });
    expect(service.executeSync).toHaveBeenCalledWith('op_parked', { initialContext: nextContext });
  });

  // Regression: the resumed non-streaming response came back with no output.
  it('returns the step state when the resume step already finished the run', async () => {
    const service = runtime();
    const answered = { messages: [{ content: 'sunny', role: 'assistant' }], status: 'done' };
    service.executeStep.mockResolvedValue({
      state: answered,
      stepResult: { nextContext: { phase: 'done' } },
    });

    await expect(
      executeResponseRun(service as any, { operationId: 'op_parked', resumed: true }),
    ).resolves.toBe(answered);
    expect(service.executeSync).not.toHaveBeenCalled();
  });

  // Regression: a resume reloads the conversation as display groups, which
  // produced no output at all; returning the whole group would also repeat the
  // answered call and make the caller run its tool again.
  it('returns only the turn after the answered calls', async () => {
    const service = runtime();
    service.executeStep.mockResolvedValue({
      state: {
        messages: [
          { content: 'weather?', id: 'msg_user', role: 'user' },
          {
            children: [
              { content: '', id: 'msg_call', tools: [{ apiName: 'get_weather', id: 'call_1' }] },
              { content: 'It is sunny.', id: 'msg_answer' },
            ],
            id: 'msg_call',
            role: 'assistantGroup',
          },
        ],
        status: 'done',
      },
      stepResult: {},
    });

    const state = await executeResponseRun(service as any, {
      callIds: ['call_1'],
      operationId: 'op_parked',
      resumed: true,
    });

    expect(state.messages).toEqual([
      { content: 'It is sunny.', id: 'msg_answer', role: 'assistant' },
    ]);
  });

  it('reports a held run as still waiting, without the calls it just answered', async () => {
    const service = runtime({ ...parkedState(), pendingToolsCalling: [weatherCall, subAgentCall] });

    const state = await executeResponseRun(service as any, {
      callIds: ['call_1'],
      held: true,
      operationId: 'op_parked',
      resumed: true,
    });

    expect(service.executeStep).not.toHaveBeenCalled();
    expect(state).toMatchObject({ messages: [], pendingToolsCalling: [subAgentCall] });
  });

  it('runs a new operation as before', async () => {
    const service = runtime();
    service.executeSync.mockResolvedValue({ status: 'done' });

    await executeResponseRun(service as any, { operationId: 'op_new' });

    expect(service.executeStep).not.toHaveBeenCalled();
    expect(service.executeSync).toHaveBeenCalledWith('op_new');
  });
});

describe('pendingFunctionCallItems', () => {
  // Regression: a non-streaming response parked on a client tool had no
  // function_call item, so the caller had no call_id to answer.
  it('lists the parked calls the output does not already carry', () => {
    // A server-side call of the same batch is not the caller's to answer.
    const state = { messages: [], pendingToolsCalling: [weatherCall, subAgentCall] } as any;

    expect(pendingFunctionCallItems(state, [], 'tpc_1')).toEqual([
      {
        arguments: '{}',
        call_id: 'call_1',
        id: 'fc_tpc_1_pending_0',
        name: 'get_weather',
        status: 'completed',
        type: 'function_call',
      },
    ]);
    expect(
      pendingFunctionCallItems(
        state,
        [{ call_id: 'call_1', type: 'function_call' } as any],
        'tpc_1',
      ),
    ).toEqual([]);
  });
});

describe('parkedOnToolsReason', () => {
  it('names what a parked run waits on', () => {
    expect(parkedOnToolsReason({ status: 'waiting_for_async_tool' } as any)).toBe(
      'client_tool_execution',
    );
    expect(
      parkedOnToolsReason({
        interruption: { reason: 'async_tool' },
        status: 'waiting_for_async_tool',
      } as any),
    ).toBe('async_tool');
    expect(parkedOnToolsReason({ status: 'done' } as any)).toBeUndefined();
  });
});
