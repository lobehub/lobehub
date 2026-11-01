import type {
  ChatToolPayload,
  CreateMessageParams,
  UIChatMessage,
  WorkRegistrationIntent,
} from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import type { AgentRuntimeHost, ToolRunExecution } from '../transport';
import type { AgentInstruction, AgentState } from '../types';
import { omitToolWorkRegistration } from '../utils/redactResultForEvents';
import { callTool, callToolsBatch } from './tool';

const call: ChatToolPayload = {
  apiName: 'createDocument',
  arguments: '{"title":"one document"}',
  id: 'call-document',
  identifier: 'documents',
  type: 'builtin',
};

const fixture = (rows: Partial<UIChatMessage>[] = []) => {
  const stored = rows.map((row) => ({
    content: '',
    id: 'tool-existing',
    parentId: 'assistant-1',
    role: 'tool',
    tool_call_id: call.id,
    ...row,
  })) as UIChatMessage[];
  const messages = {
    createToolMessage: vi.fn(async (params: CreateMessageParams) => {
      const message = { ...params, id: `tool-${stored.length + 1}` } as UIChatMessage;
      stored.push(message);
      return message;
    }),
    deleteMessage: vi.fn(),
    findToolMessageIdByToolCallId: vi.fn(
      async (id: string, parentId: string) =>
        stored.find((row) => row.tool_call_id === id && row.parentId === parentId)?.id,
    ),
    getToolMessage: vi.fn(async (id: string) => stored.find((row) => row.id === id)),
    query: vi.fn(async () => structuredClone(stored).map(omitToolWorkRegistration)),
    updateToolIntervention: vi.fn(),
    updateToolMessage: vi.fn(async (id: string, value: Partial<UIChatMessage>) => {
      const row = stored.find((row) => row.id === id)!;
      Object.assign(row, value);
    }),
  };
  let documents = 0;
  const tools = {
    beforeToolCall: vi.fn(),
    getCost: vi.fn(() => 0),
    run: vi.fn(async (): Promise<ToolRunExecution> => {
      documents++;
      return {
        attempts: 1,
        result: {
          content: 'Created document docs-one',
          executionTime: 20,
          state: { documentId: 'docs-one' },
          success: true,
        },
      };
    }),
  };
  const host = {
    operation: { operationId: 'operation-1', stepIndex: 1 },
    transports: {
      messages,
      stream: { publishChunk: vi.fn(), publishEvent: vi.fn() },
      tools,
    },
  } as unknown as AgentRuntimeHost;
  const state = {
    cost: {
      currency: 'USD',
      llm: { byModel: [], total: 0 },
      tools: { byTool: [], total: 0 },
      total: 0,
    },
    messages: [],
    operationId: 'operation-1',
    origin: { agentId: 'agent-1', topicId: 'topic-1' },
    status: 'running',
    stepCount: 1,
    usage: { tools: { byTool: [], totalCalls: 0, totalTimeMs: 0 } },
  } as unknown as AgentState;
  return { documents: () => documents, host, messages, state, stored, tools };
};

describe.each(['single', 'batch'] as const)('%s tool step redelivery', (mode) => {
  const execute = (f: ReturnType<typeof fixture>, extra = {}) => {
    const instruction =
      mode === 'single'
        ? {
            payload: { parentMessageId: 'assistant-1', toolCalling: call, ...extra },
            type: 'call_tool',
          }
        : {
            payload: { parentMessageId: 'assistant-1', toolsCalling: [call], ...extra },
            type: 'call_tools_batch',
          };
    return (mode === 'single' ? callTool : callToolsBatch)(f.host)(
      instruction as AgentInstruction,
      f.state,
    );
  };

  it('reuses a complete durable result without running hooks, side effects, or writing another row', async () => {
    const f = fixture([
      { content: 'Created original document', pluginState: { documentId: 'original' } },
    ]);
    const result = await execute(f);
    expect(f.tools.run).not.toHaveBeenCalled();
    expect(f.tools.beforeToolCall).not.toHaveBeenCalled();
    expect(f.messages.createToolMessage).not.toHaveBeenCalled();
    expect(f.messages.updateToolMessage).not.toHaveBeenCalled();
    expect(result.newState.messages).toContainEqual(
      expect.objectContaining({
        content: 'Created original document',
        id: 'tool-existing',
        pluginState: { documentId: 'original' },
      }),
    );
    expect(result.nextContext?.phase).toBe(
      mode === 'single' ? 'tool_result' : 'tools_batch_result',
    );
  });

  it.each([
    { content: '', pluginState: { status: 'pending' } },
    { content: '', pluginIntervention: { status: 'approved' } },
    { content: '...', pluginState: {} },
    { content: 'preview', pluginState: { status: 'pending' } },
  ])('fills an incomplete placeholder in place: %j', async (placeholder) => {
    const f = fixture([placeholder as Partial<UIChatMessage>]);
    await execute(f);
    expect(f.documents()).toBe(1);
    expect(f.messages.createToolMessage).not.toHaveBeenCalled();
    expect(f.stored).toHaveLength(1);
    await execute(f);
    expect(f.documents()).toBe(1);
    expect(f.stored[0]).toMatchObject({
      id: 'tool-existing',
      content: 'Created document docs-one',
    });
    expect(f.tools.run).toHaveBeenCalledWith(
      call,
      expect.objectContaining({
        reuseExistingMessage: true,
        toolMessageId: 'tool-existing',
      }),
    );
  });

  it('replaces a placeholder already present in the restored model context', async () => {
    const f = fixture([{ content: '', pluginState: { status: 'pending' } }]);
    f.state.messages = structuredClone(f.stored);
    const result = await execute(f);
    const rows = result.newState.messages.filter((row) => row.tool_call_id === call.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].content).toBe('Created document docs-one');
  });

  it('executes a fresh call once and reuses the committed result when its step is replayed', async () => {
    const f = fixture();
    await execute(f);
    await execute(f); // Deliberately replay the pre-step checkpoint, not the returned state.
    expect(f.documents()).toBe(1);
    expect(f.stored).toHaveLength(1);
    expect(f.tools.run).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      action: 'register',
      document: { documentId: 'docs-one', changeType: 'created', toolName: 'createDocument' },
      type: 'document',
    },
    {
      args: { title: 'original title' },
      data: { url: 'https://example.com/items/42', body: 'untruncated result' },
      provider: 'example',
      toolName: 'createItem',
      type: 'skill',
    },
  ] satisfies WorkRegistrationIntent[])(
    'replays a durable %s Work intent after registration is interrupted',
    async (intent) => {
      const f = fixture();
      const registerWork = vi
        .fn()
        .mockRejectedValueOnce(new Error('worker stopped'))
        .mockResolvedValue(undefined);
      f.host.transports.tools!.registerWork = registerWork;
      f.tools.run.mockResolvedValue({
        attempts: 1,
        result: {
          content: 'truncated result',
          executionTime: 20,
          success: true,
          workRegistration: intent,
        },
      });
      if (mode === 'batch') await expect(execute(f)).rejects.toThrow('worker stopped');
      else await execute(f);
      expect(f.stored).toHaveLength(1);
      const persisted = structuredClone(f.stored);
      // A new host has only the committed message, not the first execution's intent.
      const resumed = fixture(persisted);
      resumed.host.transports.tools!.registerWork = registerWork;
      const result = await execute(resumed);
      expect(resumed.tools.run).not.toHaveBeenCalled();
      expect(registerWork).toHaveBeenCalledTimes(2);
      expect(registerWork.mock.calls[1][0]).toMatchObject({
        intent,
        sourceMessageId: persisted[0].id,
        sourceToolCallId: call.id,
        state: registerWork.mock.calls[0][0].state,
      });
      if (intent.type === 'skill') {
        expect(result.events).not.toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              result: expect.objectContaining({ workRegistration: intent }),
            }),
          ]),
        );
        expect(JSON.stringify(result.newState.messages)).not.toContain('untruncated result');
      }
    },
  );

  it.each(['constructor', '__proto__'])(
    'executes provider call id %s as an own key',
    async (id) => {
      const f = fixture();
      const originalId = call.id;
      call.id = id;
      try {
        await execute(f);
        expect(f.tools.run).toHaveBeenCalledOnce();
      } finally {
        call.id = originalId;
      }
    },
  );

  it('reuses a completed empty result with persisted execution metadata', async () => {
    const f = fixture([
      { content: '', metadata: { toolExecutionTimeMs: 20, toolResultSuccess: true } },
    ]);
    await execute(f);
    expect(f.tools.run).not.toHaveBeenCalled();
    expect(f.stored).toHaveLength(1);
  });

  it('does not reuse a provider call id from another assistant', async () => {
    const f = fixture([{ content: 'unrelated result', parentId: 'other-assistant' }]);
    await execute(f);
    expect(f.documents()).toBe(1);
    expect(f.stored).toHaveLength(2);
  });

  it('reuses a persisted error instead of repeating the failed side effect', async () => {
    const f = fixture([
      { content: 'Tool failed', pluginError: { message: 'failed', type: 'ToolError' } },
    ]);
    const result = await execute(f);
    expect(f.tools.run).not.toHaveBeenCalled();
    expect(result.events).toContainEqual(
      expect.objectContaining({
        id: call.id,
        result: expect.objectContaining({ content: 'Tool failed', success: false }),
        type: 'tool_result',
      }),
    );
  });

  it('reuses completed client results without parking the operation again', async () => {
    const f = fixture([{ content: 'client result' }]);
    f.state.toolSourceMap = { documents: 'client' as never };
    f.host.transports.tools!.beforeToolCall = undefined;
    const result = await execute(f);
    expect(f.tools.run).not.toHaveBeenCalled();
    expect(result.newState.status).toBe('running');
    expect(f.host.transports.stream.publishChunk).not.toHaveBeenCalled();
  });

  it('reuses a complete result from an explicit approval-resume row', async () => {
    const f = fixture([{ content: 'approved call already completed' }]);
    const result = await execute(
      f,
      mode === 'single'
        ? { parentMessageId: 'tool-existing', skipCreateToolMessage: true }
        : { existingToolMessageIds: { [call.id]: 'tool-existing' } },
    );
    expect(f.tools.run).not.toHaveBeenCalled();
    expect(result.newState.messages).toContainEqual(
      expect.objectContaining({ content: 'approved call already completed' }),
    );
  });

  it('propagates a failed replay lookup without executing any side effect', async () => {
    const f = fixture();
    f.messages.findToolMessageIdByToolCallId.mockRejectedValue(new Error('database unavailable'));
    await expect(execute(f)).rejects.toThrow('database unavailable');
    expect(f.tools.run).not.toHaveBeenCalled();
  });

  it('preserves a committed result if Stop was observed before the replay', async () => {
    const f = fixture([{ content: 'committed result' }]);
    f.host.operation.abortSignal = AbortSignal.abort();
    const result = await execute(f);
    expect(f.tools.run).not.toHaveBeenCalled();
    expect(f.messages.updateToolMessage).not.toHaveBeenCalled();
    expect(result.newState.messages).toContainEqual(
      expect.objectContaining({ content: 'committed result' }),
    );
  });

  it('preserves an unsuccessful result without an error on replay', async () => {
    const f = fixture();
    f.tools.run.mockResolvedValue({
      attempts: 1,
      result: {
        content: 'Handled failure',
        executionTime: 20,
        state: {},
        success: false,
      },
    });
    await execute(f);
    const replayed = await execute(f);
    expect(replayed.events).toContainEqual(
      expect.objectContaining({
        result: expect.objectContaining({ success: false }),
        type: 'tool_result',
      }),
    );
    expect(f.tools.run).toHaveBeenCalledTimes(1);
  });

  if (mode === 'single')
    it('preserves a terminal stop result on replay', async () => {
      const f = fixture();
      f.tools.run.mockResolvedValue({
        attempts: 1,
        result: {
          content: 'Finished',
          executionTime: 20,
          state: {},
          success: true,
          stop: true,
        },
      } as never);
      await execute(f);
      expect((await execute(f)).newState.status).toBe('done');
      expect(f.tools.run).toHaveBeenCalledTimes(1);
    });
});
