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
  let findToolMessageIdByToolCallId: ReturnType<typeof vi.fn>;
  let updateToolIntervention: ReturnType<typeof vi.fn>;
  let updateToolMessage: ReturnType<typeof vi.fn>;
  /**
   * `tool_call_id → row id`, the store's view of which calls already have a row.
   * Writes register here so a later lookup finds them — the same reason the real
   * settle can ask instead of being told.
   */
  let toolRows: Map<string, { id: string; parentId: string }>;
  let publishChunk: ReturnType<typeof vi.fn>;
  let publishError: ReturnType<typeof vi.fn>;
  let publishEvent: ReturnType<typeof vi.fn>;
  let query: ReturnType<typeof vi.fn>;
  let runTool: ReturnType<typeof vi.fn>;
  let host: AgentRuntimeHost;

  beforeEach(() => {
    toolRows = new Map();
    createToolMessage = vi.fn().mockImplementation(async (params: any) => {
      if (params?.tool_call_id) {
        toolRows.set(params.tool_call_id, { id: 'tool-msg-1', parentId: params.parentId });
      }
      return { id: 'tool-msg-1' };
    });
    findToolMessageIdByToolCallId = vi
      .fn()
      .mockImplementation(async (toolCallId: string, parentMessageId: string) => {
        const row = toolRows.get(toolCallId);
        return row && row.parentId === parentMessageId ? row.id : undefined;
      });
    updateToolIntervention = vi.fn().mockResolvedValue(undefined);
    updateToolMessage = vi.fn().mockResolvedValue(undefined);
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
          findToolMessageIdByToolCallId,
          query,
          update: vi.fn(),
          updatePluginState: vi.fn(),
          updateToolIntervention,
          updateToolMessage,
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
    expect(result.newState.messages).toContainEqual(
      expect.objectContaining({ id: 'tool-msg-1', role: 'tool' }),
    );
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

  it('settles the existing row when the transport reports cancellation', async () => {
    runTool.mockResolvedValueOnce({
      attempts: 0,
      interrupted: true,
      result: { content: 'Cancelled', success: false },
      resultPersisted: true,
      toolMessageId: 'cancelled-tool-msg',
    });
    const toolCall = createToolCall();
    toolRows.set(toolCall.id, { id: 'cancelled-tool-msg', parentId: 'assistant-msg-1' });
    const instruction: Extract<AgentInstruction, { type: 'call_tool' }> = {
      payload: { parentMessageId: 'assistant-msg-1', toolCalling: toolCall },
      type: 'call_tool',
    };

    const result = await callTool(host)(instruction, createState());

    // The transport already made a row for this call — settle THAT one rather
    // than inserting a second one beside it.
    expect(createToolMessage).not.toHaveBeenCalled();
    expect(updateToolMessage).toHaveBeenCalledWith('cancelled-tool-msg', {
      content: 'Tool execution was aborted by user.',
    });
    expect(updateToolIntervention).toHaveBeenCalledWith('cancelled-tool-msg', {
      status: 'aborted',
    });
    expect(result.newState.messages).toContainEqual(
      expect.objectContaining({ role: 'tool', tool_call_id: toolCall.id }),
    );
  });

  it('writes an aborted row when the operation aborts mid-run', async () => {
    const controller = new AbortController();
    const abortingHost = {
      ...host,
      operation: { ...host.operation, abortSignal: controller.signal },
    } as typeof host;

    runTool.mockImplementationOnce(
      () =>
        new Promise(() => {
          // never settles — the abort is what ends the wait
        }),
    );

    const toolCall = createToolCall();
    const instruction: Extract<AgentInstruction, { type: 'call_tool' }> = {
      payload: { parentMessageId: 'assistant-msg-1', toolCalling: toolCall },
      type: 'call_tool',
    };

    const pending = callTool(abortingHost)(instruction, createState());
    controller.abort();
    const result = await pending;

    // Every tool_call_id gets exactly one row, even one that never returned.
    expect(createToolMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Tool execution was aborted by user.',
        parentId: 'assistant-msg-1',
        pluginIntervention: { status: 'aborted' },
        role: 'tool',
        tool_call_id: toolCall.id,
      }),
    );
    expect(result.newState.messages).toContainEqual(
      expect.objectContaining({ role: 'tool', tool_call_id: toolCall.id }),
    );
    // An abort is not a tool failure: no error event, no handleError bookkeeping.
    expect(result.events).toEqual([]);
    expect(host.transports.tools!.handleError).not.toHaveBeenCalled();
    // Whether the run ends is the caller's call — a user Stop persists
    // `interrupted` on its own; this executor must not decide it.
    expect(result.newState.status).toBe('running');
  });

  it('observes a late transport rejection after a synchronous abort', async () => {
    const controller = new AbortController();
    const abortingHost = {
      ...host,
      operation: { ...host.operation, abortSignal: controller.signal },
    } as typeof host;
    let rejectTransport: ((error: Error) => void) | undefined;
    runTool.mockImplementationOnce(() => {
      controller.abort();
      return new Promise((_, reject) => {
        rejectTransport = reject;
      });
    });

    const toolCall = createToolCall();
    const instruction: Extract<AgentInstruction, { type: 'call_tool' }> = {
      payload: { parentMessageId: 'assistant-msg-1', toolCalling: toolCall },
      type: 'call_tool',
    };

    const result = await callTool(abortingHost)(instruction, createState());
    rejectTransport!(new Error('transport failed after abort'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(result.newState.messages).toContainEqual(
      expect.objectContaining({ role: 'tool', tool_call_id: toolCall.id }),
    );
    expect(host.transports.tools!.handleError).not.toHaveBeenCalled();
  });

  it('never starts a tool when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const abortingHost = {
      ...host,
      operation: { ...host.operation, abortSignal: controller.signal },
    } as typeof host;

    const toolCall = createToolCall();
    const instruction: Extract<AgentInstruction, { type: 'call_tool' }> = {
      payload: { parentMessageId: 'assistant-msg-1', toolCalling: toolCall },
      type: 'call_tool',
    };

    const result = await callTool(abortingHost)(instruction, createState());

    // No transport ever inspects `context.abortSignal` before doing its work, so
    // launching it here would spawn the process Stop was meant to prevent.
    expect(runTool).not.toHaveBeenCalled();
    expect(createToolMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Tool execution was aborted by user.',
        tool_call_id: toolCall.id,
      }),
    );
    expect(result.newState.messages).toContainEqual(
      expect.objectContaining({ role: 'tool', tool_call_id: toolCall.id }),
    );
  });

  it('settles the pending approval row when an approved tool is aborted', async () => {
    const controller = new AbortController();
    const abortingHost = {
      ...host,
      operation: { ...host.operation, abortSignal: controller.signal },
    } as typeof host;

    runTool.mockImplementationOnce(
      () =>
        new Promise(() => {
          // never settles — the abort is what ends the wait
        }),
    );

    const toolCall = createToolCall();
    // The approval pause wrote this row before parking.
    toolRows.set(toolCall.id, { id: 'pending-tool-row', parentId: 'assistant-msg-1' });
    const instruction: Extract<AgentInstruction, { type: 'call_tool' }> = {
      payload: {
        // On an approval resume this IS the pending tool row, not an assistant.
        parentMessageId: 'pending-tool-row',
        skipCreateToolMessage: true,
        toolCalling: toolCall,
      },
      type: 'call_tool',
    };

    const pending = callTool(abortingHost)(instruction, createState());
    controller.abort();
    await pending;

    // Creating a row here would duplicate the tool_call_id, strand the approval
    // card as `pending`, and parent a tool row to another tool row.
    expect(createToolMessage).not.toHaveBeenCalled();
    expect(updateToolMessage).toHaveBeenCalledWith('pending-tool-row', {
      content: 'Tool execution was aborted by user.',
    });
    expect(updateToolIntervention).toHaveBeenCalledWith('pending-tool-row', {
      status: 'aborted',
    });
    expect(findToolMessageIdByToolCallId).not.toHaveBeenCalled();
  });

  it('settles a client-only call instead of parking it when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const abortingHost = {
      ...host,
      operation: { ...host.operation, abortSignal: controller.signal },
    } as typeof host;

    const toolCall = createToolCall('client-call', 'client-tool');
    const instruction: Extract<AgentInstruction, { type: 'call_tool' }> = {
      payload: { parentMessageId: 'assistant-msg-1', toolCalling: toolCall },
      type: 'call_tool',
    };

    const result = await callTool(abortingHost)(
      instruction,
      createState({ toolSourceMap: { 'client-tool': 'client' as any } }),
    );

    // Nothing will come back to collect a parked call in an aborted run.
    expect(publishChunk).not.toHaveBeenCalled();
    expect(createToolMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Tool execution was aborted by user.',
        tool_call_id: toolCall.id,
      }),
    );
    expect(result.newState.messages).toContainEqual(
      expect.objectContaining({ role: 'tool', tool_call_id: toolCall.id }),
    );
  });

  it('settles a client-only call when aborted while publishing the pause chunk', async () => {
    const controller = new AbortController();
    const abortingHost = {
      ...host,
      operation: { ...host.operation, abortSignal: controller.signal },
    } as typeof host;
    let finishPublishing: (() => void) | undefined;
    publishChunk.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishPublishing = resolve;
        }),
    );

    const toolCall = createToolCall('client-call', 'client-tool');
    const instruction: Extract<AgentInstruction, { type: 'call_tool' }> = {
      payload: { parentMessageId: 'assistant-msg-1', toolCalling: toolCall },
      type: 'call_tool',
    };

    const pending = callTool(abortingHost)(
      instruction,
      createState({ toolSourceMap: { 'client-tool': 'client' as any } }),
    );
    await vi.waitFor(() => expect(finishPublishing).toBeTypeOf('function'));
    controller.abort();
    finishPublishing!();
    const result = await pending;

    expect(result.newState.status).toBe('running');
    expect(result.newState.messages).toContainEqual(
      expect.objectContaining({ role: 'tool', tool_call_id: toolCall.id }),
    );
    expect(createToolMessage).toHaveBeenCalledTimes(1);
  });

  it('treats an unrelated AbortError as a tool failure, not a user stop', async () => {
    // The operation signal is live — this rejection is the transport's own
    // timeout, so it must keep normal error handling and must NOT persist a row
    // claiming the user aborted it.
    const foreign = new Error('fetch timed out');
    foreign.name = 'AbortError';
    runTool.mockRejectedValueOnce(foreign);

    const toolCall = createToolCall();
    const instruction: Extract<AgentInstruction, { type: 'call_tool' }> = {
      payload: { parentMessageId: 'assistant-msg-1', toolCalling: toolCall },
      type: 'call_tool',
    };

    const result = await callTool(host)(instruction, createState());

    expect(host.transports.tools!.handleError).toHaveBeenCalled();
    expect(publishError).toHaveBeenCalled();
    expect(result.events).toContainEqual(expect.objectContaining({ type: 'error' }));
    expect(createToolMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ content: 'Tool execution was aborted by user.' }),
    );
  });

  it('settles the row the transport already created when a client tool is aborted', async () => {
    const controller = new AbortController();
    const abortingHost = {
      ...host,
      operation: { ...host.operation, abortSignal: controller.signal },
    } as typeof host;

    // The client transport persists its row before executing, and only surfaces
    // the id through a settled run — which an abort never gives us.
    const toolCall = createToolCall();
    runTool.mockImplementationOnce(
      () =>
        new Promise(() => {
          // The client transport persists its row before executing, so by the
          // time the abort lands the store already knows about it.
          toolRows.set(toolCall.id, { id: 'optimistic-row', parentId: 'assistant-msg-1' });
          controller.abort();
        }),
    );

    const instruction: Extract<AgentInstruction, { type: 'call_tool' }> = {
      payload: { parentMessageId: 'assistant-msg-1', toolCalling: toolCall },
      type: 'call_tool',
    };

    await callTool(abortingHost)(instruction, createState());

    expect(createToolMessage).not.toHaveBeenCalled();
    expect(updateToolMessage).toHaveBeenCalledWith('optimistic-row', {
      content: 'Tool execution was aborted by user.',
    });
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
    // The transport-persisted row is still just tool output hanging off the
    // calling assistant; the spine anchor stays that assistant.
    expect(result.nextContext?.payload).toMatchObject({ parentMessageId: 'assistant-msg-1' });
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

  it('keeps finished batch results and writes aborted rows only for the rest', async () => {
    const controller = new AbortController();
    const abortingHost = {
      ...host,
      operation: { ...host.operation, abortSignal: controller.signal },
    } as typeof host;

    const settled = createToolCall('settled-call');
    const stuck = createToolCall('stuck-call');

    runTool.mockImplementation((tool: any) =>
      tool.id === settled.id
        ? Promise.resolve({
            attempts: 1,
            result: { content: 'done', executionTime: 1, success: true },
          })
        : new Promise(() => {
            // never settles — abort is what ends the wait
          }),
    );

    const instruction: Extract<AgentInstruction, { type: 'call_tools_batch' }> = {
      payload: { parentMessageId: 'assistant-msg-1', toolsCalling: [settled, stuck] },
      type: 'call_tools_batch',
    };

    const pending = callToolsBatch(abortingHost)(instruction, createState());
    // Let the settled tool resolve and persist its row before the abort lands.
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    const result = await pending;

    // The finished tool keeps its real result...
    expect(result.events).toContainEqual(
      expect.objectContaining({ id: settled.id, type: 'tool_result' }),
    );
    // ...and only the in-flight one gets an aborted row. Two rows total, one
    // per tool_call_id — a partially settled batch must not lose either half.
    expect(createToolMessage).toHaveBeenCalledTimes(2);
    expect(createToolMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Tool execution was aborted by user.',
        tool_call_id: stuck.id,
      }),
    );
  });

  it('settles unstarted client tools instead of parking them when a mixed batch aborts', async () => {
    const controller = new AbortController();
    const abortingHost = {
      ...host,
      operation: { ...host.operation, abortSignal: controller.signal },
    } as typeof host;

    const serverCall = createToolCall('server-call');
    const clientCall = createToolCall('client-call', 'client-tool');

    runTool.mockImplementation(
      () =>
        new Promise(() => {
          // never settles — the abort is what ends the wait
        }),
    );

    const instruction: Extract<AgentInstruction, { type: 'call_tools_batch' }> = {
      payload: { parentMessageId: 'assistant-msg-1', toolsCalling: [serverCall, clientCall] },
      type: 'call_tools_batch',
    };

    const pending = callToolsBatch(abortingHost)(
      instruction,
      createState({ toolSourceMap: { 'client-tool': 'client' as any } }),
    );
    controller.abort();
    await pending;

    // The client call never started, and the pause it was waiting for would park
    // it into a run nothing resumes — leaving its tool_call_id with no row ever.
    const settledIds = createToolMessage.mock.calls.map((call: any) => call[0].tool_call_id);
    expect(settledIds).toContain(serverCall.id);
    expect(settledIds).toContain(clientCall.id);
    expect(publishChunk).not.toHaveBeenCalledWith(
      expect.objectContaining({ chunkType: 'tools_calling' }),
    );
  });

  it('writes one row per tool_call_id even if a call reaches the settle twice', async () => {
    const controller = new AbortController();
    controller.abort();
    const abortingHost = {
      ...host,
      operation: { ...host.operation, abortSignal: controller.signal },
    } as typeof host;

    const dupe = createToolCall('dupe-call');
    const instruction: Extract<AgentInstruction, { type: 'call_tools_batch' }> = {
      payload: { parentMessageId: 'assistant-msg-1', toolsCalling: [dupe, dupe] },
      type: 'call_tools_batch',
    };

    await callToolsBatch(abortingHost)(instruction, createState());

    // Callers merge several abort sources into one list; "exactly one row per
    // tool_call_id" has to survive that.
    expect(createToolMessage).toHaveBeenCalledTimes(1);
  });

  it('settles a client-only batch instead of parking it when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const abortingHost = {
      ...host,
      operation: { ...host.operation, abortSignal: controller.signal },
    } as typeof host;

    const a = createToolCall('client-a', 'client-tool');
    const b = createToolCall('client-b', 'client-tool');
    const instruction: Extract<AgentInstruction, { type: 'call_tools_batch' }> = {
      payload: { parentMessageId: 'assistant-msg-1', toolsCalling: [a, b] },
      type: 'call_tools_batch',
    };

    const result = await callToolsBatch(abortingHost)(
      instruction,
      createState({ toolSourceMap: { 'client-tool': 'client' as any } }),
    );

    expect(publishChunk).not.toHaveBeenCalled();
    const settledIds = createToolMessage.mock.calls.map((call: any) => call[0].tool_call_id);
    expect(settledIds).toEqual([a.id, b.id]);
    expect(result.newState.messages).toHaveLength(2);
  });

  it('settles a client-only batch when aborted while publishing the pause chunk', async () => {
    const controller = new AbortController();
    const abortingHost = {
      ...host,
      operation: { ...host.operation, abortSignal: controller.signal },
    } as typeof host;
    let finishPublishing: (() => void) | undefined;
    publishChunk.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishPublishing = resolve;
        }),
    );

    const a = createToolCall('client-a', 'client-tool');
    const b = createToolCall('client-b', 'client-tool');
    const instruction: Extract<AgentInstruction, { type: 'call_tools_batch' }> = {
      payload: { parentMessageId: 'assistant-msg-1', toolsCalling: [a, b] },
      type: 'call_tools_batch',
    };

    const pending = callToolsBatch(abortingHost)(
      instruction,
      createState({ toolSourceMap: { 'client-tool': 'client' as any } }),
    );
    await vi.waitFor(() => expect(finishPublishing).toBeTypeOf('function'));
    controller.abort();
    finishPublishing!();
    const result = await pending;

    expect(result.newState.status).toBe('running');
    expect(result.newState.messages).toHaveLength(2);
    expect(createToolMessage).toHaveBeenCalledTimes(2);
  });

  it('settles approved client rows in a mixed batch rather than duplicating them', async () => {
    const controller = new AbortController();
    controller.abort();
    const abortingHost = {
      ...host,
      operation: { ...host.operation, abortSignal: controller.signal },
    } as typeof host;

    const serverCall = createToolCall('server-call');
    const clientCall = createToolCall('client-call', 'client-tool');

    // An approved batch resume left a pending row for EVERY call, including the
    // client ones that never enter `toolsToExecute`.
    toolRows.set(serverCall.id, { id: 'server-row', parentId: 'assistant-msg-1' });
    toolRows.set(clientCall.id, { id: 'client-row', parentId: 'assistant-msg-1' });
    const instruction: Extract<AgentInstruction, { type: 'call_tools_batch' }> = {
      payload: {
        parentMessageId: 'assistant-msg-1',
        toolsCalling: [serverCall, clientCall],
      },
      type: 'call_tools_batch',
    };

    await callToolsBatch(abortingHost)(
      instruction,
      createState({ toolSourceMap: { 'client-tool': 'client' as any } }),
    );

    expect(createToolMessage).not.toHaveBeenCalled();
    expect(updateToolIntervention).toHaveBeenCalledWith('client-row', { status: 'aborted' });
    expect(updateToolIntervention).toHaveBeenCalledWith('server-row', { status: 'aborted' });
  });

  it('ignores a reused tool_call_id that belongs to another turn', async () => {
    const controller = new AbortController();
    controller.abort();
    const abortingHost = {
      ...host,
      operation: { ...host.operation, abortSignal: controller.signal },
    } as typeof host;

    const toolCall = createToolCall();
    // Same id, different assistant — `tool_call_id` is provider-supplied and
    // only indexed, so a reuse across turns is possible. Settling that row would
    // overwrite a real historical result AND leave this call without one.
    toolRows.set(toolCall.id, { id: 'older-turn-row', parentId: 'assistant-msg-OLD' });

    const instruction: Extract<AgentInstruction, { type: 'call_tool' }> = {
      payload: { parentMessageId: 'assistant-msg-1', toolCalling: toolCall },
      type: 'call_tool',
    };

    await callTool(abortingHost)(instruction, createState());

    expect(updateToolMessage).not.toHaveBeenCalledWith('older-turn-row', expect.anything());
    expect(createToolMessage).toHaveBeenCalledWith(
      expect.objectContaining({ parentId: 'assistant-msg-1', tool_call_id: toolCall.id }),
    );
  });

  describe('parallel batch parent chain', () => {
    // The next assistant turn hangs off `nextContext.parentMessageId`. A step is
    // ONE LLM call, and a batch's tool rows are inline data of the call that
    // emitted them — so the anchor is that assistant, never a tool row. Picking
    // a tool row made the spine depend on which promise settled last: the parent
    // chain forked, and a DFS over the parentId forest (how a topic is ordered
    // for reading) emitted the losing tools after the rest of the conversation.
    const batchOf = (ids: string[]): Extract<AgentInstruction, { type: 'call_tools_batch' }> => ({
      payload: {
        parentMessageId: 'assistant-msg-1',
        toolsCalling: ids.map((id) => createToolCall(id)),
      },
      type: 'call_tools_batch',
    });

    it('anchors the next turn on the assistant that emitted the batch, not a tool row', async () => {
      // Finish order is deliberately the reverse of declaration order.
      const delays: Record<string, number> = { 'call-a': 30, 'call-b': 20, 'call-c': 0 };
      runTool = vi.fn().mockImplementation(async (tool: { id: string }) => {
        await new Promise((resolve) => setTimeout(resolve, delays[tool.id] ?? 0));
        return {
          attempts: 1,
          result: { content: `result ${tool.id}`, executionTime: 1, state: {}, success: true },
        };
      });
      createToolMessage = vi
        .fn()
        .mockImplementation(async ({ tool_call_id }: { tool_call_id: string }) => ({
          id: `tool-msg-${tool_call_id}`,
        }));
      host.transports.tools!.run = runTool;
      host.transports.messages.createToolMessage = createToolMessage;

      const result = await callToolsBatch(host)(
        batchOf(['call-a', 'call-b', 'call-c']),
        createState(),
      );

      expect(result.nextContext?.phase).toBe('tools_batch_result');
      expect(result.nextContext?.payload).toMatchObject({
        parentMessageId: 'assistant-msg-1',
      });
    });

    it('is stable across runs regardless of which tool resolves first', async () => {
      const parents: string[] = [];

      for (const delays of [
        { 'call-a': 0, 'call-b': 10, 'call-c': 20 },
        { 'call-a': 20, 'call-b': 0, 'call-c': 10 },
        { 'call-a': 10, 'call-b': 20, 'call-c': 0 },
      ]) {
        host.transports.tools!.run = vi.fn().mockImplementation(async (tool: { id: string }) => {
          await new Promise((resolve) => setTimeout(resolve, (delays as any)[tool.id] ?? 0));
          return {
            attempts: 1,
            result: { content: 'ok', executionTime: 1, state: {}, success: true },
          };
        });
        host.transports.messages.createToolMessage = vi
          .fn()
          .mockImplementation(async ({ tool_call_id }: { tool_call_id: string }) => ({
            id: `tool-msg-${tool_call_id}`,
          }));

        const result = await callToolsBatch(host)(
          batchOf(['call-a', 'call-b', 'call-c']),
          createState(),
        );
        parents.push((result.nextContext?.payload as any).parentMessageId);
      }

      expect(parents).toEqual(['assistant-msg-1', 'assistant-msg-1', 'assistant-msg-1']);
    });

    it('keeps the assistant anchor when a tool in the batch fails', async () => {
      host.transports.tools!.run = vi.fn().mockImplementation(async (tool: { id: string }) => {
        if (tool.id === 'call-c') throw new Error('tool blew up');
        if (tool.id === 'call-a') await new Promise((resolve) => setTimeout(resolve, 20));
        return {
          attempts: 1,
          result: { content: 'ok', executionTime: 1, state: {}, success: true },
        };
      });
      host.transports.messages.createToolMessage = vi
        .fn()
        .mockImplementation(async ({ tool_call_id }: { tool_call_id: string }) => ({
          id: `tool-msg-${tool_call_id}`,
        }));

      const result = await callToolsBatch(host)(
        batchOf(['call-a', 'call-b', 'call-c']),
        createState(),
      );

      // A tool row was never the anchor, so a tool that produced no message
      // can't leave the spine empty either.
      expect(result.nextContext?.payload).toMatchObject({
        parentMessageId: 'assistant-msg-1',
      });
    });

    it('fills existing pending rows in place when resuming an approved batch', async () => {
      const updateToolMessage = vi.fn().mockResolvedValue(undefined);
      host.transports.messages.updateToolMessage = updateToolMessage;
      host.transports.messages.createToolMessage = createToolMessage;

      const instruction: Extract<AgentInstruction, { type: 'call_tools_batch' }> = {
        payload: {
          existingToolMessageIds: { 'call-a': 'pending-msg-a', 'call-b': 'pending-msg-b' },
          parentMessageId: 'assistant-msg-1',
          toolsCalling: [createToolCall('call-a'), createToolCall('call-b')],
        },
        type: 'call_tools_batch',
      };

      const result = await callToolsBatch(host)(instruction, createState());

      // Creating fresh rows here would strand the approved-but-empty originals
      // under the same assistant.
      expect(createToolMessage).not.toHaveBeenCalled();
      expect(updateToolMessage).toHaveBeenCalledWith(
        'pending-msg-a',
        expect.objectContaining({ content: 'Tool result' }),
      );
      expect(updateToolMessage).toHaveBeenCalledWith(
        'pending-msg-b',
        expect.objectContaining({ content: 'Tool result' }),
      );
      // Resuming an approved batch continues from the assistant that emitted
      // it, exactly like a batch that never paused.
      expect(result.nextContext?.payload).toMatchObject({ parentMessageId: 'assistant-msg-1' });
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

  describe('todo state forwarding', () => {
    // Todo-mutating tools (lobe-agent createTodos/updateTodos) persist their own
    // copy into a plan document that only exists after `createPlan`. Message
    // history is the store that always exists, so the run context must carry it
    // — otherwise `updateTodos` reloads an empty list and silently drops every
    // index-based operation.
    const stateWithTodos = () =>
      createState({
        messages: [
          {
            content: 'todo tool result',
            id: 'tool-msg-0',
            plugin: { apiName: 'createTodos', identifier: 'lobe-agent', type: 'builtin' },
            pluginState: {
              todos: {
                items: [
                  { status: 'completed', text: 'env setup' },
                  { status: 'todo', text: 'run case 1' },
                ],
                updatedAt: '2026-07-09T00:00:00.000Z',
              },
            },
            role: 'tool',
          },
        ] as unknown as AgentState['messages'],
      });

    it('forwards todos rebuilt from message history to the tool transport', async () => {
      const instruction: Extract<AgentInstruction, { type: 'call_tool' }> = {
        payload: {
          parentMessageId: 'assistant-msg-1',
          toolCalling: createToolCall('tool-call-1', 'lobe-agent'),
        },
        type: 'call_tool',
      };

      await callTool(host)(instruction, stateWithTodos());

      expect(runTool).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          currentTodos: [
            { status: 'completed', text: 'env setup' },
            { status: 'todo', text: 'run case 1' },
          ],
        }),
      );
    });

    it('leaves currentTodos undefined when no todo state exists yet', async () => {
      const instruction: Extract<AgentInstruction, { type: 'call_tool' }> = {
        payload: {
          parentMessageId: 'assistant-msg-1',
          toolCalling: createToolCall(),
        },
        type: 'call_tool',
      };

      await callTool(host)(instruction, createState());

      expect(runTool.mock.calls[0][1].currentTodos).toBeUndefined();
    });
  });
});
