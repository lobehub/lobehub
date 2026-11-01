import type { Mock } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentRuntimeHost } from '../transport';
import type { AgentInstruction } from '../types';
import { callTool } from './tool';
import { createState, createToolCall, createToolExecutorFixture } from './tool.testUtils';

describe('single tool executors', () => {
  let createToolMessage: Mock;
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
  let runTool: Mock;
  let host: AgentRuntimeHost;

  beforeEach(() => {
    ({
      createToolMessage,
      findToolMessageIdByToolCallId,
      updateToolIntervention,
      updateToolMessage,
      toolRows,
      publishChunk,
      publishError,
      publishEvent,
      query,
      runTool,
      host,
    } = createToolExecutorFixture());
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
        metadata: expect.objectContaining({ toolExecutionTimeMs: 100 }),
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

  it('deduplicates activatedTools persisted in one tool result (PR #20791 P2 regression)', async () => {
    // persistActivatedTools updates its dedup set inside the filter: a result
    // listing the same plugin twice (e.g. two wire names of one plugin both
    // resolved to the same identifier) must be appended once.
    runTool = vi.fn().mockResolvedValue({
      attempts: 1,
      result: {
        content: 'Tool result',
        executionTime: 100,
        state: {
          activatedTools: [
            { identifier: 'lobe-web-browsing' },
            { identifier: 'lobe-web-browsing' },
          ],
        },
        success: true,
      },
    });
    host.transports.tools!.run = runTool;

    const instruction: Extract<AgentInstruction, { type: 'call_tool' }> = {
      payload: {
        parentMessageId: 'assistant-msg-1',
        toolCalling: createToolCall(),
      },
      type: 'call_tool',
    };

    const result = await callTool(host)(instruction, createState());

    const stepTools = result.newState.activatedStepTools ?? [];
    expect(stepTools).toHaveLength(1);
    expect(stepTools[0]).toMatchObject({ id: 'lobe-web-browsing', source: 'discovery' });
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

  // An approved async tool (group member task / sub-agent) resumes with the
  // approve op's seeded "…" placeholder still on state. Parking keeps nothing in
  // it: the server-side resume writes its own reply, and the empty seed left
  // under the tool hid that reply.
  it('retires the resume-seeded placeholder when an approved async tool parks', async () => {
    runTool.mockResolvedValue({
      attempts: 1,
      result: {
        content: '',
        deferred: true,
        state: { status: 'pending', toolMessageId: 'approved-tool' },
        success: true,
      },
    });

    toolRows.set('task-call', { id: 'approved-tool', parentId: 'assistant-msg-1' });
    const result = await callTool(host)(
      {
        payload: {
          parentMessageId: 'approved-tool',
          skipCreateToolMessage: true,
          toolCalling: createToolCall('task-call', 'lobe-group-management'),
        },
        type: 'call_tool',
      },
      createState({ pendingAssistantMessageId: 'seeded-placeholder' } as any),
    );

    expect(result.newState.status).toBe('waiting_for_async_tool');
    expect(host.transports.messages.deleteMessage).toHaveBeenCalledWith('seeded-placeholder');
    expect(result.newState.pendingAssistantMessageId).toBeUndefined();
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
});
