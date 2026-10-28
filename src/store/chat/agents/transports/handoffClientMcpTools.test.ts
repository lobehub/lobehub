import type { AgentRuntimeHost } from '@lobechat/agent-runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ChatStore } from '@/store/chat/store';

import { prepareClientMcpTools } from './handoffClientMcpTools';

const api = vi.hoisted(() => ({ register: vi.fn(), lease: vi.fn(), cancel: vi.fn() }));
vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  getActiveWorkspaceId: () => null,
}));
vi.mock('@/libs/trpc/client', () => ({
  createWorkspaceLambdaClient: () => ({
    mcpElicitation: {
      registerClientStep: { mutate: api.register },
      leaseClientStep: { mutate: api.lease },
      cancelClientStep: { mutate: api.cancel },
    },
  }),
}));
const tool = {
  id: 'call_1',
  identifier: 'fixture',
  apiName: 'form',
  arguments: '{"zero":0}',
  type: 'mcp' as const,
};
function fixture() {
  const callbacks: (() => Promise<void>)[] = [];
  const controller = new AbortController();
  const create = vi.fn(async () => ({ id: `row-${create.mock.calls.length}` }));
  const host = {
    operation: { operationId: 'local', agentId: 'agent', topicId: 'topic' },
    transports: {
      messages: {
        findById: vi.fn().mockResolvedValue({ id: 'assistant', role: 'assistant' }),
        createToolMessage: create,
      },
    },
  } as unknown as AgentRuntimeHost;
  const store = {
    operations: { local: { context: {}, abortController: controller } },
    updateOperationMetadata: vi.fn(),
    executeGatewayAgent: vi.fn(),
    registerAfterCompletionCallback: vi.fn((_id, cb) => callbacks.push(cb)),
  } as unknown as ChatStore;
  api.lease.mockResolvedValue(undefined);
  api.cancel.mockResolvedValue(true);
  api.register.mockResolvedValue({ operationId: 'durable', deadline: Date.now() + 120_000 });
  return { host, store, create, callbacks, controller };
}
afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});
describe('client MCP persistence preserves execution mode', () => {
  it('keeps mixed tools on the original client executors without requiring or consulting Gateway', async () => {
    vi.useFakeTimers();
    const f = fixture();
    const builtin = { ...tool, id: 'call_2', type: 'builtin' as const };
    const prepared = await prepareClientMcpTools(
      f.host,
      {
        type: 'call_tools_batch',
        payload: {
          parentMessageId: 'assistant',
          toolsCalling: [tool, builtin],
        },
      },
      () => f.store,
    );
    expect(f.create).toHaveBeenCalledTimes(2);
    expect(f.create.mock.calls[0][0]).not.toHaveProperty('pluginIntervention');
    expect(api.register).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantMessageId: 'assistant',
        toolMessageIds: ['row-1', 'row-2'],
      }),
    );
    expect(prepared).toMatchObject({
      type: 'call_tools_batch',
      payload: {
        toolsCalling: [tool, builtin],
        existingToolMessageIds: { call_1: 'row-1', call_2: 'row-2' },
      },
    });
    expect(f.store.executeGatewayAgent).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(api.lease).toHaveBeenCalledOnce();
    await f.callbacks[0]();
    expect(api.lease).toHaveBeenLastCalledWith(expect.objectContaining({ finish: true }));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(api.lease).toHaveBeenCalledTimes(2);
  });
  it('reuses approved tool messages, preserves original visible IDs and stops heartbeats on cancel', async () => {
    vi.useFakeTimers();
    const f = fixture();
    const prepared = await prepareClientMcpTools(
      f.host,
      {
        type: 'call_tool',
        payload: {
          parentMessageId: 'existing-tool',
          skipCreateToolMessage: true,
          toolCalling: tool,
        },
      },
      () => f.store,
    );
    expect(f.create).not.toHaveBeenCalled();
    expect(prepared).toMatchObject({
      payload: { parentMessageId: 'existing-tool', toolCalling: tool, skipCreateToolMessage: true },
    });
    f.controller.abort();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(api.lease).not.toHaveBeenCalled();
    expect(api.cancel).toHaveBeenCalledWith(expect.objectContaining({ operationId: 'durable' }));
  });
  it('leaves non-MCP instructions unchanged and never executes after persistence fails', async () => {
    const f = fixture();
    const plain = {
      type: 'call_tool' as const,
      payload: { parentMessageId: 'assistant', toolCalling: { ...tool, type: 'builtin' as const } },
    };
    expect(await prepareClientMcpTools(f.host, plain, () => f.store)).toBe(plain);
    expect(api.register).not.toHaveBeenCalled();
    api.register.mockRejectedValueOnce(new Error('persistence unavailable'));
    await expect(
      prepareClientMcpTools(
        f.host,
        { ...plain, payload: { ...plain.payload, toolCalling: tool } },
        () => f.store,
      ),
    ).rejects.toThrow('persistence unavailable');
    expect(f.store.executeGatewayAgent).not.toHaveBeenCalled();
  });
});
