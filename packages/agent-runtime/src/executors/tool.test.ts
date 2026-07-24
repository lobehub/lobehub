import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentRuntimeHost } from '../transport';
import type { AgentInstruction, AgentRuntimeContext, AgentState } from '../types';
import { callTool, callToolsBatch } from './tool';

const createCost = () => ({
  calculatedAt: '2026-07-09T00:00:00.000Z',
  currency: 'USD',
  llm: { byModel: [], currency: 'USD', total: 0 },
  tools: { byTool: [], currency: 'USD', total: 0 },
  total: 0,
});

const createUsage = () => ({
  humanInteraction: {
    approvalRequests: 0,
    promptRequests: 0,
    selectRequests: 0,
    totalWaitingTimeMs: 0,
  },
  llm: { apiCalls: 0, processingTimeMs: 0, tokens: { input: 0, output: 0, total: 0 } },
  tools: { byTool: [], totalCalls: 0, totalTimeMs: 0 },
});

const createState = (overrides?: Partial<AgentState>): AgentState => ({
  cost: createCost(),
  createdAt: '2026-07-09T00:00:00.000Z',
  lastModified: '2026-07-09T00:00:00.000Z',
  maxSteps: 100,
  messages: [],
  metadata: {
    agentId: 'agent-1',
    threadId: 'thread-1',
    topicId: 'topic-1',
  },
  operationId: 'op-1',
  status: 'running',
  stepCount: 0,
  toolManifestMap: {},
  usage: createUsage(),
  ...overrides,
});

const createToolCall = (id = 'tool-call-1', identifier = 'web-search') => ({
  apiName: 'search',
  arguments: '{"query":"test"}',
  id,
  identifier,
  type: 'default' as const,
});

describe('tool executors', () => {
  let createToolMessage: ReturnType<typeof vi.fn>;
  let publishChunk: ReturnType<typeof vi.fn>;
  let publishError: ReturnType<typeof vi.fn>;
  let publishEvent: ReturnType<typeof vi.fn>;
  let query: ReturnType<typeof vi.fn>;
  let runTool: ReturnType<typeof vi.fn>;
  let host: AgentRuntimeHost;

  beforeEach(() => {
    createToolMessage = vi.fn().mockResolvedValue({ id: 'tool-msg-1' });
    publishChunk = vi.fn().mockResolvedValue(undefined);
    publishError = vi.fn().mockResolvedValue(undefined);
    publishEvent = vi.fn().mockResolvedValue(undefined);
    query = vi.fn().mockResolvedValue([{ content: 'refreshed', id: 'msg-1', role: 'user' }]);
    runTool = vi.fn().mockResolvedValue({
      attempts: 1,
      result: {
        content: 'Tool result',
        executionTime: 100,
        state: {},
        success: true,
      },
    });

    host = {
      operation: {
        operationId: 'op-1',
        stepIndex: 2,
      },
      transports: {
        messages: {
          createAssistantMessage: vi.fn(),
          createToolMessage,
          deleteMessage: vi.fn(),
          findById: vi.fn(),
          query,
          update: vi.fn(),
          updatePluginState: vi.fn(),
          updateToolMessage: vi.fn(),
        },
        stream: {
          publishChunk,
          publishError,
          publishEvent,
        },
        tools: {
          getCost: vi.fn().mockReturnValue(0),
          handleError: vi.fn(),
          maxRetries: 2,
          run: runTool,
        },
      },
    } as unknown as AgentRuntimeHost;
  });

  it('executes a single tool, persists the result, and advances to tool_result', async () => {
    const instruction: Extract<AgentInstruction, { type: 'call_tool' }> = {
      payload: {
        parentMessageId: 'assistant-msg-1',
        toolCalling: createToolCall(),
      },
      type: 'call_tool',
    };

    const result = await callTool(host)(instruction, createState());

    expect(runTool).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'tool-call-1' }),
      expect.objectContaining({
        callIndex: 1,
        parentMessageId: 'assistant-msg-1',
        parsedArgs: { query: 'test' },
        toolName: 'web-search/search',
      }),
    );
    expect(createToolMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Tool result',
        metadata: { toolExecutionTimeMs: 100 },
        parentId: 'assistant-msg-1',
        role: 'tool',
        tool_call_id: 'tool-call-1',
      }),
    );
    expect(publishEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'tool_start' }));
    expect(publishEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ attempts: 1, isSuccess: true }),
        type: 'tool_end',
      }),
    );
    expect(result.nextContext?.phase).toBe('tool_result');
    expect(result.nextContext?.payload).toMatchObject({ parentMessageId: 'tool-msg-1' });
    expect(result.newState.usage.tools.totalCalls).toBe(1);
  });

  it('parks single client-source tools without invoking the transport runner', async () => {
    const instruction: Extract<AgentInstruction, { type: 'call_tool' }> = {
      payload: {
        parentMessageId: 'assistant-msg-1',
        toolCalling: createToolCall('client-call', 'client-tool'),
      },
      type: 'call_tool',
    };

    const result = await callTool(host)(
      instruction,
      createState({ toolSourceMap: { 'client-tool': 'client' as any } }),
    );

    expect(runTool).not.toHaveBeenCalled();
    expect(publishChunk).toHaveBeenCalledWith(
      expect.objectContaining({
        chunkType: 'tools_calling',
        toolsCalling: [expect.objectContaining({ id: 'client-call' })],
      }),
    );
    expect(result.newState.status).toBe('waiting_for_async_tool');
    expect(result.events).toContainEqual(
      expect.objectContaining({ reason: 'client_tool_execution', type: 'interrupted' }),
    );
  });

  it('executes client-source tools when the transport supports local execution', async () => {
    host.transports.tools!.canRunClientTools = true;
    const instruction: Extract<AgentInstruction, { type: 'call_tool' }> = {
      payload: {
        parentMessageId: 'assistant-msg-1',
        toolCalling: createToolCall('client-call', 'client-tool'),
      },
      type: 'call_tool',
    };

    const result = await callTool(host)(
      instruction,
      createState({ toolSourceMap: { 'client-tool': 'client' as any } }),
    );

    expect(runTool).toHaveBeenCalledOnce();
    expect(result.newState.status).toBe('running');
    expect(result.nextContext?.phase).toBe('tool_result');
  });

  it('uses a tool message already persisted by the transport', async () => {
    runTool.mockResolvedValueOnce({
      attempts: 1,
      result: { content: 'Client result', executionTime: 10, success: true },
      resultPersisted: true,
      toolMessageId: 'client-tool-msg',
    });
    const instruction: Extract<AgentInstruction, { type: 'call_tool' }> = {
      payload: { parentMessageId: 'assistant-msg-1', toolCalling: createToolCall() },
      type: 'call_tool',
    };

    const result = await callTool(host)(instruction, createState());

    expect(createToolMessage).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledWith({
      agentId: 'agent-1',
      groupId: undefined,
      threadId: 'thread-1',
      topicId: 'topic-1',
    });
    expect(result.nextContext?.payload).toMatchObject({ parentMessageId: 'client-tool-msg' });
  });

  it('does not advance after the transport reports cancellation', async () => {
    runTool.mockResolvedValueOnce({
      attempts: 0,
      interrupted: true,
      result: { content: 'Cancelled', success: false },
      resultPersisted: true,
      toolMessageId: 'cancelled-tool-msg',
    });
    const instruction: Extract<AgentInstruction, { type: 'call_tool' }> = {
      payload: { parentMessageId: 'assistant-msg-1', toolCalling: createToolCall() },
      type: 'call_tool',
    };
    const state = createState();

    const result = await callTool(host)(instruction, state);

    expect(result).toEqual({ events: [], newState: state });
    expect(createToolMessage).not.toHaveBeenCalled();
  });

  it('terminates removed client sub-agent stop states like other stop results', async () => {
    const instruction: Extract<AgentInstruction, { type: 'call_tool' }> = {
      payload: { parentMessageId: 'assistant-msg-1', toolCalling: createToolCall() },
      type: 'call_tool',
    };

    runTool.mockResolvedValueOnce({
      attempts: 1,
      result: {
        content: 'Dispatch client sub-agent',
        state: { type: 'execClientSubAgent' },
        stop: true,
        success: true,
      },
    });
    const stopped = await callTool(host)(instruction, createState());

    expect(stopped.newState.status).toBe('done');
    expect(stopped.nextContext).toBeUndefined();
  });

  // A deferred tool (callSubAgent) parks the parent WITHOUT a tool_end, so the
  // pause chunk is the only thing that can tell the client its placeholder row
  // exists. Drop `toolMessageIds` and the row never enters the client store —
  // every later update addressed at it silently no-ops.
  it('advertises a deferred tool placeholder id on the pause chunk', async () => {
    runTool.mockResolvedValue({
      attempts: 1,
      result: {
        content: '',
        deferred: true,
        state: { status: 'pending', threadId: 'thread-9', toolMessageId: 'tool-msg-deferred' },
        success: true,
      },
    });

    const instruction: Extract<AgentInstruction, { type: 'call_tool' }> = {
      payload: {
        parentMessageId: 'assistant-msg-1',
        toolCalling: createToolCall('sub-agent-call', 'lobe-agent'),
      },
      type: 'call_tool',
    };

    const result = await callTool(host)(instruction, createState());

    expect(publishChunk).toHaveBeenCalledWith(
      expect.objectContaining({
        chunkType: 'tools_calling',
        toolMessageIds: { 'sub-agent-call': 'tool-msg-deferred' },
      }),
    );
    // No tool_end for a deferred tool — the completion bridge resolves it later.
    expect(publishEvent).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'tool_end' }));
    expect(result.newState.status).toBe('waiting_for_async_tool');
    expect(result.events).toContainEqual(
      expect.objectContaining({ reason: 'async_tool', type: 'interrupted' }),
    );
  });

  it('omits toolMessageIds when a deferred tool reports no placeholder', async () => {
    runTool.mockResolvedValue({
      attempts: 1,
      result: { content: '', deferred: true, state: { status: 'pending' }, success: true },
    });

    await callTool(host)(
      {
        payload: {
          parentMessageId: 'assistant-msg-1',
          toolCalling: createToolCall('sub-agent-call', 'lobe-agent'),
        },
        type: 'call_tool',
      },
      createState(),
    );

    expect(publishChunk).toHaveBeenCalledWith(
      expect.not.objectContaining({ toolMessageIds: expect.anything() }),
    );
  });

  it('collects placeholder ids for every deferred tool in a batch', async () => {
    runTool.mockImplementation(async (tool: { id: string }) => ({
      attempts: 1,
      result: {
        content: '',
        deferred: true,
        state: { status: 'pending', toolMessageId: `msg-for-${tool.id}` },
        success: true,
      },
    }));

    await callToolsBatch(host)(
      {
        payload: {
          parentMessageId: 'assistant-msg-1',
          toolsCalling: [
            createToolCall('sub-a', 'lobe-agent'),
            createToolCall('sub-b', 'lobe-agent'),
          ],
        },
        type: 'call_tools_batch',
      },
      createState(),
    );

    expect(publishChunk).toHaveBeenCalledWith(
      expect.objectContaining({
        toolMessageIds: { 'sub-a': 'msg-for-sub-a', 'sub-b': 'msg-for-sub-b' },
      }),
    );
  });

  it('passes the current step context to every tool in a batch', async () => {
    const stepContext = {
      activatedToolIds: ['page-editor'],
      hasQueuedMessages: true,
    };
    const runtimeContext = {
      phase: 'llm_result',
      stepContext,
    } satisfies AgentRuntimeContext;

    await callToolsBatch(host)(
      {
        payload: {
          parentMessageId: 'assistant-msg-1',
          toolsCalling: [createToolCall('tool-a'), createToolCall('tool-b')],
        },
        type: 'call_tools_batch',
      },
      createState(),
      runtimeContext,
    );

    expect(runTool).toHaveBeenCalledTimes(2);
    expect(runTool.mock.calls.map(([, runContext]) => runContext.stepContext)).toEqual([
      stepContext,
      stepContext,
    ]);
  });

  it('executes server tools in a mixed batch then parks for client tools', async () => {
    const instruction: Extract<AgentInstruction, { type: 'call_tools_batch' }> = {
      payload: {
        parentMessageId: 'assistant-msg-1',
        toolsCalling: [createToolCall('server-call'), createToolCall('client-call', 'client-tool')],
      },
      type: 'call_tools_batch',
    };

    const result = await callToolsBatch(host)(
      instruction,
      createState({ toolSourceMap: { 'client-tool': 'client' as any } }),
    );

    expect(runTool).toHaveBeenCalledTimes(1);
    expect(createToolMessage).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(
      {
        agentId: 'agent-1',
        groupId: undefined,
        threadId: 'thread-1',
        topicId: 'topic-1',
      },
      { flatten: true, resolveAssetUrls: true },
    );
    expect(result.newState.status).toBe('waiting_for_async_tool');
    expect(result.newState.pendingToolsCalling).toEqual([
      expect.objectContaining({ id: 'client-call' }),
    ]);
    expect(result.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'server-call', type: 'tool_result' }),
        expect.objectContaining({ reason: 'client_tool_execution', type: 'interrupted' }),
      ]),
    );
  });

  it('uses tool messages already persisted by the transport in a batch', async () => {
    host.transports.tools!.canRunClientTools = true;
    runTool.mockResolvedValueOnce({
      attempts: 1,
      result: { content: 'Client result', executionTime: 10, success: true },
      resultPersisted: true,
      toolMessageId: 'client-tool-msg',
    });
    const instruction: Extract<AgentInstruction, { type: 'call_tools_batch' }> = {
      payload: {
        parentMessageId: 'assistant-msg-1',
        toolsCalling: [createToolCall('client-call', 'client-tool')],
      },
      type: 'call_tools_batch',
    };

    const result = await callToolsBatch(host)(
      instruction,
      createState({ toolSourceMap: { 'client-tool': 'client' as any } }),
    );

    expect(createToolMessage).not.toHaveBeenCalled();
    expect(host.transports.messages.updateToolMessage).not.toHaveBeenCalled();
    expect(result.nextContext?.payload).toMatchObject({ parentMessageId: 'client-tool-msg' });
  });

  it('publishes and rethrows tool-message persist errors', async () => {
    const error = new Error('database failed');
    createToolMessage.mockRejectedValueOnce(error);
    const instruction: Extract<AgentInstruction, { type: 'call_tool' }> = {
      payload: {
        parentMessageId: 'assistant-msg-1',
        toolCalling: createToolCall(),
      },
      type: 'call_tool',
    };

    await expect(callTool(host)(instruction, createState())).rejects.toThrow('database failed');
    expect(publishError).toHaveBeenCalledWith({
      error,
      phase: 'tool_message_persist',
      stepIndex: 2,
    });
  });

  describe('work registration redaction', () => {
    // A skill intent carries the UNTRUNCATED tool payload (`data`/`args`) solely
    // for server-side Work registration. It must NOT ride the published stream
    // event nor the returned `events` array (which get serialized into the
    // capped Redis step blob) — clients only read `workRegistration` as a
    // presence flag.
    const createSkillIntent = () => ({
      args: { number: 42, repo: 'lobehub/lobehub' },
      data: { body: 'x'.repeat(500), issues: Array.from({ length: 30 }, (_, i) => ({ id: i })) },
      provider: 'github',
      toolName: 'github.searchIssues',
      type: 'skill' as const,
    });

    const findEvent = (calls: unknown[][], type: string) =>
      calls.map((call) => call[0] as any).find((event) => event?.type === type);

    it('redacts a skill intent on the stream event and returned events, but registers the full intent (single path)', async () => {
      const skillIntent = createSkillIntent();
      const registerWork = vi.fn().mockResolvedValue(undefined);
      host.transports.tools!.registerWork = registerWork;
      runTool.mockResolvedValueOnce({
        attempts: 1,
        result: {
          content: 'issue found',
          executionTime: 100,
          state: {},
          success: true,
          workRegistration: skillIntent,
        },
      });
      const instruction: Extract<AgentInstruction, { type: 'call_tool' }> = {
        payload: { parentMessageId: 'assistant-msg-1', toolCalling: createToolCall() },
        type: 'call_tool',
      };

      const result = await callTool(host)(instruction, createState());

      // 1) Published `tool_end` stream event: presence flag preserved, payload stripped.
      const toolEnd = findEvent(publishEvent.mock.calls, 'tool_end');
      expect(toolEnd.data.result.workRegistration).toEqual({
        args: undefined,
        data: null,
        provider: 'github',
        toolName: 'github.searchIssues',
        type: 'skill',
      });

      // 2) Returned step `events` array (serialized into the Redis step blob).
      const toolResultEvent = result.events.find(
        (event: any) => event.type === 'tool_result',
      ) as any;
      expect(toolResultEvent.result.workRegistration.data).toBeNull();
      expect(toolResultEvent.result.workRegistration.args).toBeUndefined();

      // 3) `registerWork` still receives the FULL intent (data + args intact).
      expect(registerWork).toHaveBeenCalledTimes(1);
      const registeredIntent = registerWork.mock.calls[0][0].intent;
      expect(registeredIntent.data).toEqual(skillIntent.data);
      expect(registeredIntent.args).toEqual(skillIntent.args);
    });

    it('passes a non-skill (task) intent through unredacted (single path)', async () => {
      const taskIntent = {
        action: 'create',
        targets: [{ taskId: 'task-9' }],
        type: 'task' as const,
      };
      host.transports.tools!.registerWork = vi.fn().mockResolvedValue(undefined);
      runTool.mockResolvedValueOnce({
        attempts: 1,
        result: {
          content: 'task created',
          executionTime: 100,
          state: {},
          success: true,
          workRegistration: taskIntent,
        },
      });
      const instruction: Extract<AgentInstruction, { type: 'call_tool' }> = {
        payload: { parentMessageId: 'assistant-msg-1', toolCalling: createToolCall() },
        type: 'call_tool',
      };

      const result = await callTool(host)(instruction, createState());

      const toolEnd = findEvent(publishEvent.mock.calls, 'tool_end');
      expect(toolEnd.data.result.workRegistration).toEqual(taskIntent);
      const toolResultEvent = result.events.find(
        (event: any) => event.type === 'tool_result',
      ) as any;
      expect(toolResultEvent.result.workRegistration).toEqual(taskIntent);
    });

    it('redacts a skill intent on the returned events but registers the full intent (batch path)', async () => {
      const skillIntent = createSkillIntent();
      const registerWork = vi.fn().mockResolvedValue(undefined);
      host.transports.tools!.registerWork = registerWork;
      runTool.mockResolvedValue({
        attempts: 1,
        result: {
          content: 'issue found',
          executionTime: 100,
          state: {},
          success: true,
          workRegistration: skillIntent,
        },
      });
      const instruction: Extract<AgentInstruction, { type: 'call_tools_batch' }> = {
        payload: {
          parentMessageId: 'assistant-msg-1',
          toolsCalling: [createToolCall('server-call')],
        },
        type: 'call_tools_batch',
      };

      const result = await callToolsBatch(host)(instruction, createState());

      const toolResultEvent = result.events.find(
        (event: any) => event.type === 'tool_result',
      ) as any;
      expect(toolResultEvent.result.workRegistration.data).toBeNull();
      expect(toolResultEvent.result.workRegistration.args).toBeUndefined();

      const toolEnd = findEvent(publishEvent.mock.calls, 'tool_end');
      expect(toolEnd.data.result.workRegistration.data).toBeNull();

      expect(registerWork).toHaveBeenCalledTimes(1);
      const registeredIntent = registerWork.mock.calls[0][0].intent;
      expect(registeredIntent.data).toEqual(skillIntent.data);
      expect(registeredIntent.args).toEqual(skillIntent.args);
    });
  });
});
