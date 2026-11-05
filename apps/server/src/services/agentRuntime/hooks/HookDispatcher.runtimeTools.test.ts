import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentEvalConnectorService } from '@/server/services/agentEvalConnector';
import { createEvalConnectorHook } from '@/server/services/agentRuntime/AgentRuntimeService/evalConnectorHook';
import { createEvalToolGateHook } from '@/server/services/agentRuntime/AgentRuntimeService/evalToolGateHook';

import { HookDispatcher } from './HookDispatcher';

const boundary = vi.hoisted(() => ({ deliver: vi.fn(), queue: true }));
vi.mock('@/server/services/queue/impls', () => ({
  isQueueAgentRuntimeEnabled: () => boundary.queue,
}));
vi.mock('@lobechat/env/agentHook', () => ({ getAgentHookConfig: () => ({}) }));
vi.mock('./httpWebhook', () => ({
  deliverWebhook: boundary.deliver,
  executeToolCallWebhook: vi.fn(),
}));
vi.mock('@/database/models/user', () => ({ UserModel: { getEmailsByIds: async () => [] } }));
vi.mock('@/database/server', () => ({ getServerDB: async () => ({}) }));

const operationId = 'queued-eval-operation';
const alias = 'lobe-web-browsing';
const snapshots = {
  [alias]: {
    connectorId: 'exact-connection',
    datasetId: 'dataset',
    fingerprint: 'frozen',
    transport: 'mcp' as const,
  },
};
const event = {
  apiName: 'search',
  args: { query: 'fixture' },
  identifier: alias,
  stepIndex: 2,
  userId: 'user',
};
const hooks = () => [
  createEvalToolGateHook([alias]),
  createEvalConnectorHook({ db: {} as never, userId: 'user' }, snapshots, {
    attemptId: 'attempt',
    caseId: 'case',
  }),
];

beforeEach(() => {
  boundary.queue = true;
  boundary.deliver.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe('trusted runtime tool interceptors', () => {
  it.each([true, false])(
    'intercepts a native alias once in queue=%s without serializing the handler',
    async (queue) => {
      boundary.queue = queue;
      const execute = vi
        .spyOn(AgentEvalConnectorService.prototype, 'execute')
        .mockResolvedValue({ content: 'fixture-result', success: true });
      const dispatcher = new HookDispatcher();
      dispatcher.registerRuntimeToolHooks(operationId, hooks());
      dispatcher.registerRuntimeToolHooks(operationId, hooks());
      expect(await dispatcher.dispatchBeforeToolCall(operationId, event as never, [])).toEqual({
        isMocked: true,
        result: { content: 'fixture-result', success: true },
      });
      expect(execute).toHaveBeenCalledOnce();
      expect(execute.mock.calls[0][1]).toEqual(snapshots);
      expect(execute.mock.calls[0][2]).toMatchObject({ attemptId: 'attempt', caseId: 'case' });
      expect(dispatcher.getSerializedHooks(operationId)).toBeUndefined();
    },
  );

  it('keeps caller handlers ignored in queue mode even when their ID spoofs a runtime hook', async () => {
    const execute = vi
      .spyOn(AgentEvalConnectorService.prototype, 'execute')
      .mockResolvedValue({ content: 'real-mock-result', success: true });
    const spoof = vi.fn();
    const dispatcher = new HookDispatcher();
    dispatcher.register(operationId, [
      { id: 'eval-connector-bindings', type: 'beforeToolCall', handler: spoof },
    ]);
    dispatcher.registerRuntimeToolHooks(operationId, hooks());
    await dispatcher.dispatchBeforeToolCall(operationId, event as never, []);
    expect(spoof).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledOnce();
  });

  it('runs the allowlist gate first and never calls the connection when it refuses', async () => {
    const execute = vi.spyOn(AgentEvalConnectorService.prototype, 'execute');
    const dispatcher = new HookDispatcher();
    dispatcher.registerRuntimeToolHooks(operationId, [createEvalToolGateHook([]), hooks()[1]]);
    expect(await dispatcher.dispatchBeforeToolCall(operationId, event as never, [])).toMatchObject({
      isMocked: true,
      result: { success: false },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('fails closed when a runtime interceptor throws instead of falling through to an ordinary handler', async () => {
    boundary.queue = false;
    const ordinary = vi.fn();
    const dispatcher = new HookDispatcher();
    dispatcher.register(operationId, [
      { handler: ordinary, id: 'ordinary', type: 'beforeToolCall' },
    ]);
    dispatcher.registerRuntimeToolHooks(operationId, [
      {
        handler: async () => {
          throw new Error('interceptor failed');
        },
        id: 'runtime',
        type: 'beforeToolCall',
      },
    ]);
    await expect(dispatcher.dispatchBeforeToolCall(operationId, event as never)).rejects.toThrow(
      'interceptor failed',
    );
    expect(ordinary).not.toHaveBeenCalled();
  });

  it('reconstructs on a cold worker and retains serialized notifications through runtime cleanup', async () => {
    vi.spyOn(AgentEvalConnectorService.prototype, 'execute').mockResolvedValue({
      content: 'fixture-result',
      success: true,
    });
    const serialized = [
      {
        id: 'complete',
        type: 'onComplete' as const,
        webhook: { url: 'https://notification.test/complete' },
      },
    ];
    for (const dispatcher of [new HookDispatcher(), new HookDispatcher()]) {
      dispatcher.register(operationId, serialized);
      dispatcher.registerRuntimeToolHooks(operationId, hooks());
      expect(
        (await dispatcher.dispatchBeforeToolCall(operationId, event as never, serialized))
          ?.isMocked,
      ).toBe(true);
      dispatcher.unregisterRuntimeToolHooks(operationId);
      expect(dispatcher.hasHook(operationId, 'eval-connector-bindings')).toBe(false);
      await dispatcher.dispatch(
        operationId,
        'onComplete',
        { operationId, status: 'done' } as never,
        serialized,
      );
    }
    expect(boundary.deliver).toHaveBeenCalledTimes(2);
  });

  it('does not restore runtime interception from a same-ID serialized webhook', async () => {
    const dispatcher = new HookDispatcher();
    const serialized = [
      {
        id: 'eval-connector-bindings',
        type: 'beforeToolCall' as const,
        webhook: { url: 'https://notification.test/observe' },
      },
    ];
    expect(
      await dispatcher.dispatchBeforeToolCall(operationId, event as never, serialized),
    ).toBeNull();
    expect(dispatcher.hasHook(operationId, 'eval-connector-bindings')).toBe(false);
  });
});
