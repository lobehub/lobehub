import type { Mock } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentRuntimeHost } from '../transport';
import type { AgentInstruction, AgentRuntimeContext } from '../types';
import { callTool, callToolsBatch } from './tool';
import { createState, createToolCall, createToolExecutorFixture } from './tool.testUtils';

describe('batch tool executors', () => {
  let createToolMessage: Mock;
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
    expect(host.transports.messages.updateToolMessage).toHaveBeenCalledWith('client-tool-msg', {
      metadata: expect.objectContaining({ toolResultSuccess: true }),
    });
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

      toolRows.set('call-a', { id: 'pending-msg-a', parentId: 'assistant-msg-1' });
      toolRows.set('call-b', { id: 'pending-msg-b', parentId: 'assistant-msg-1' });
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

  describe('serialized batch calls', () => {
    // Several editFile calls to one path in a batch reached the device at once;
    // each read the same snapshot and the last write dropped the others while
    // every call reported success. Calls naming the same resource through
    // `serializeBy` queue in emission order; other paths stay concurrent.
    const manifestMap = {
      'lobe-local-system': {
        api: [
          { name: 'editFile', serializeBy: 'file_path' },
          { name: 'writeFile', serializeBy: 'path' },
          { name: 'readFile' },
        ],
        identifier: 'lobe-local-system',
      },
    };

    const fileCall = (id: string, apiName: string, args: Record<string, unknown>) => ({
      apiName,
      arguments: JSON.stringify(args),
      id,
      identifier: 'lobe-local-system',
      type: 'builtin' as const,
    });

    const trackingRunner = (delays: Record<string, number>, timeline: string[]) =>
      vi.fn().mockImplementation(async (tool: { id: string }) => {
        timeline.push(`start:${tool.id}`);
        await new Promise((resolve) => setTimeout(resolve, delays[tool.id] ?? 0));
        timeline.push(`end:${tool.id}`);
        return {
          attempts: 1,
          result: { content: `done ${tool.id}`, executionTime: 1, state: {}, success: true },
        };
      });

    beforeEach(() => {
      host.transports.messages.createToolMessage = vi
        .fn()
        .mockImplementation(async ({ tool_call_id }: { tool_call_id: string }) => ({
          id: `tool-msg-${tool_call_id}`,
        }));
    });

    it('runs edits and writes to one path one after another, in emission order', async () => {
      const timeline: string[] = [];
      host.transports.tools!.run = trackingRunner(
        { 'edit-1': 30, 'edit-2': 10, 'write-1': 0 },
        timeline,
      );

      const result = await callToolsBatch(host)(
        {
          payload: {
            parentMessageId: 'assistant-msg-1',
            toolsCalling: [
              fileCall('edit-1', 'editFile', { file_path: '/repo/a.ts', old_string: 'x' }),
              fileCall('edit-2', 'editFile', { file_path: '/repo/a.ts', old_string: 'y' }),
              fileCall('write-1', 'writeFile', { content: 'z', path: '/repo/a.ts' }),
            ],
          },
          type: 'call_tools_batch',
        },
        createState({ toolManifestMap: manifestMap }),
      );

      expect(timeline).toEqual([
        'start:edit-1',
        'end:edit-1',
        'start:edit-2',
        'end:edit-2',
        'start:write-1',
        'end:write-1',
      ]);
      expect((result.nextContext?.payload as any).toolResults).toHaveLength(3);
    });

    it('keeps edits to different paths and unmarked reads concurrent', async () => {
      const timeline: string[] = [];
      host.transports.tools!.run = trackingRunner(
        { 'edit-a': 30, 'edit-b': 0, 'read-a': 0 },
        timeline,
      );

      await callToolsBatch(host)(
        {
          payload: {
            parentMessageId: 'assistant-msg-1',
            toolsCalling: [
              fileCall('edit-a', 'editFile', { file_path: '/repo/a.ts', old_string: 'x' }),
              fileCall('edit-b', 'editFile', { file_path: '/repo/b.ts', old_string: 'x' }),
              fileCall('read-a', 'readFile', { path: '/repo/a.ts' }),
            ],
          },
          type: 'call_tools_batch',
        },
        createState({ toolManifestMap: manifestMap }),
      );

      // All three start before the slow edit to a.ts finishes.
      expect(timeline.slice(0, 3).sort()).toEqual(['start:edit-a', 'start:edit-b', 'start:read-a']);
    });
  });

  describe('ordered batch calls', () => {
    // A model that posts a long report as several `sendMessage` calls emits
    // them in reading order, but `Promise.all` handed every call to the
    // platform at once and the channel kept whichever arrived first. An API
    // marked `ordered` runs its calls one after another in emission order;
    // everything else in the batch stays concurrent.
    const manifestMap = {
      'lobe-message': {
        api: [
          { name: 'sendMessage', ordered: true },
          { name: 'replyToThread', ordered: true },
          { name: 'readMessages' },
        ],
        identifier: 'lobe-message',
      },
    };

    const messageCall = (id: string, apiName: string) => ({
      apiName,
      arguments: '{}',
      id,
      identifier: 'lobe-message',
      type: 'builtin' as const,
    });

    const batchOf = (
      toolsCalling: ReturnType<typeof messageCall>[],
    ): Extract<AgentInstruction, { type: 'call_tools_batch' }> => ({
      payload: { parentMessageId: 'assistant-msg-1', toolsCalling },
      type: 'call_tools_batch',
    });

    /** Records `start:<id>` / `end:<id>` so the interleaving is observable. */
    const trackingRunner = (delays: Record<string, number>, timeline: string[]) =>
      vi.fn().mockImplementation(async (tool: { id: string }) => {
        timeline.push(`start:${tool.id}`);
        await new Promise((resolve) => setTimeout(resolve, delays[tool.id] ?? 0));
        timeline.push(`end:${tool.id}`);
        return {
          attempts: 1,
          result: { content: `sent ${tool.id}`, executionTime: 1, state: {}, success: true },
        };
      });

    it('runs ordered calls one after another in emission order, even when the first is slowest', async () => {
      const timeline: string[] = [];
      // Slowest first: concurrent dispatch would finish send-3 before send-1.
      host.transports.tools!.run = trackingRunner(
        { 'send-1': 30, 'send-2': 10, 'send-3': 0 },
        timeline,
      );
      host.transports.messages.createToolMessage = vi
        .fn()
        .mockImplementation(async ({ tool_call_id }: { tool_call_id: string }) => ({
          id: `tool-msg-${tool_call_id}`,
        }));

      const result = await callToolsBatch(host)(
        batchOf([
          messageCall('send-1', 'sendMessage'),
          messageCall('send-2', 'sendMessage'),
          messageCall('send-3', 'replyToThread'),
        ]),
        createState({ toolManifestMap: manifestMap }),
      );

      expect(timeline).toEqual([
        'start:send-1',
        'end:send-1',
        'start:send-2',
        'end:send-2',
        'start:send-3',
        'end:send-3',
      ]);
      // Every call still lands in the batch result.
      expect((result.nextContext?.payload as any).toolResults).toHaveLength(3);
      expect(result.nextContext?.payload).toMatchObject({ parentMessageId: 'assistant-msg-1' });
    });

    it('does not hold up unordered siblings behind the ordered chain', async () => {
      const timeline: string[] = [];
      host.transports.tools!.run = trackingRunner(
        { 'read-1': 0, 'send-1': 30, 'send-2': 10 },
        timeline,
      );
      host.transports.messages.createToolMessage = vi
        .fn()
        .mockImplementation(async ({ tool_call_id }: { tool_call_id: string }) => ({
          id: `tool-msg-${tool_call_id}`,
        }));

      await callToolsBatch(host)(
        batchOf([
          messageCall('send-1', 'sendMessage'),
          messageCall('read-1', 'readMessages'),
          messageCall('send-2', 'sendMessage'),
        ]),
        createState({ toolManifestMap: manifestMap }),
      );

      // The read finished while send-1 was still in flight …
      expect(timeline.indexOf('end:read-1')).toBeLessThan(timeline.indexOf('end:send-1'));
      // … and send-2 still waited for send-1.
      expect(timeline.indexOf('start:send-2')).toBeGreaterThan(timeline.indexOf('end:send-1'));
    });

    it('reads the flag from a step-activated manifest as well', async () => {
      const timeline: string[] = [];
      host.transports.tools!.run = trackingRunner({ 'send-1': 20, 'send-2': 0 }, timeline);
      host.transports.messages.createToolMessage = vi
        .fn()
        .mockImplementation(async ({ tool_call_id }: { tool_call_id: string }) => ({
          id: `tool-msg-${tool_call_id}`,
        }));

      await callToolsBatch(host)(
        batchOf([messageCall('send-1', 'sendMessage'), messageCall('send-2', 'sendMessage')]),
        createState({
          activatedStepTools: [
            {
              activatedAtStep: 0,
              id: 'lobe-message',
              manifest: manifestMap['lobe-message'] as any,
              source: 'activator' as any,
            },
          ],
          toolManifestMap: {},
        }),
      );

      expect(timeline).toEqual(['start:send-1', 'end:send-1', 'start:send-2', 'end:send-2']);
    });

    it('keeps unmarked calls concurrent', async () => {
      const timeline: string[] = [];
      host.transports.tools!.run = trackingRunner({ 'read-1': 20, 'read-2': 0 }, timeline);
      host.transports.messages.createToolMessage = vi
        .fn()
        .mockImplementation(async ({ tool_call_id }: { tool_call_id: string }) => ({
          id: `tool-msg-${tool_call_id}`,
        }));

      await callToolsBatch(host)(
        batchOf([messageCall('read-1', 'readMessages'), messageCall('read-2', 'readMessages')]),
        createState({ toolManifestMap: manifestMap }),
      );

      expect(timeline.indexOf('start:read-2')).toBeLessThan(timeline.indexOf('end:read-1'));
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
