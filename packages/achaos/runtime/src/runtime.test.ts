import type { ChaosExperiment, ChaosRunContext } from '@achaos/core';
import { createSeededRandom } from '@achaos/core';
import type { AgentHookEvent, AgentHookType } from '@lobechat/agent-runtime/src/types/hooks';
import { executeToolWithRetry } from '@lobechat/agent-runtime/src/utils/runtimeRetry';
import { describe, expect, it, vi } from 'vitest';

import { createRuntimeChaosAdapter } from './adapter';
import { deliverCompletionWithChaos } from './completion';
import { RuntimeChaosController } from './controller';
import { executeToolAttemptWithChaos } from './toolAttempt';
import { createBeforeToolCallChaosHandler, createRuntimeChaosHooks } from './toolHook';

const contextFor = (
  effect: ChaosExperiment['effect'],
  selector: Record<string, unknown>,
  options?: { maxInjections?: number; runId?: string; signal?: AbortSignal },
): ChaosRunContext => ({
  environment: 'test',
  experiment: {
    cleanup: 'always',
    description: 'runtime fault',
    effect,
    id: 'runtime-fault',
    layer: 'L2-agent-runtime',
    oracles: [{ name: 'noop' }],
    safety: { allowedEnvironments: ['test'], maxInjections: options?.maxInjections },
    seed: 'seed',
    target: { adapter: 'runtime', selector },
    timeoutMs: 1000,
    trigger: { when: 'before' },
  },
  random: createSeededRandom('seed'),
  runId: options?.runId ?? 'run-runtime',
  signal: options?.signal ?? new AbortController().signal,
});

describe('runtime chaos adapter', () => {
  it('returns hooks assignable to the execAgent hook contract', () => {
    type ExecAgentHook = {
      handler: (event: AgentHookEvent) => Promise<void>;
      id: string;
      type: AgentHookType;
    };
    const hooks: ExecAgentHook[] = createRuntimeChaosHooks(new RuntimeChaosController());
    expect(hooks[0]?.type).toBe('beforeToolCall');
  });

  it('injects deterministic result replacement through beforeToolCall', async () => {
    const controller = new RuntimeChaosController();
    const adapter = createRuntimeChaosAdapter(controller);
    const receipt = await adapter.inject(
      contextFor({ content: '{"ok":false}', type: 'replace_result' }, { apiName: 'search' }),
    );
    const mock = vi.fn(() => true);
    await createBeforeToolCallChaosHandler(controller)({
      apiName: 'search',
      callIndex: 0,
      mock,
      operationId: 'op-1',
      stepIndex: 1,
    });
    expect(mock).toHaveBeenCalledWith({
      content: '{"ok":false}',
      success: true,
    });
    await expect(adapter.verifyInjection!(receipt, contextFor({ type: 'drop' }, {}))).resolves.toBe(
      true,
    );
  });

  it('reports an armed but unmatched runtime fault as inactive', async () => {
    const controller = new RuntimeChaosController();
    const adapter = createRuntimeChaosAdapter(controller);
    const receipt = await adapter.inject(
      contextFor({ type: 'drop' }, { apiName: 'missing', phase: 'before_tool_call' }),
    );
    await expect(adapter.verifyInjection!(receipt, contextFor({ type: 'drop' }, {}))).resolves.toBe(
      false,
    );
  });

  it('does not apply a non-delay fault after its parent run is aborted', async () => {
    const parent = new AbortController();
    const controller = new RuntimeChaosController();
    const adapter = createRuntimeChaosAdapter(controller);
    const receipt = await adapter.inject(
      contextFor(
        { type: 'drop' },
        { apiName: 'search', phase: 'before_tool_call' },
        { signal: parent.signal },
      ),
    );
    parent.abort('run completed');
    const mock = vi.fn(() => true);
    await createBeforeToolCallChaosHandler(controller)({
      apiName: 'search',
      callIndex: 0,
      mock,
      operationId: 'op-later',
      stepIndex: 2,
    });
    expect(mock).not.toHaveBeenCalled();
    await expect(adapter.verifyInjection!(receipt, contextFor({ type: 'drop' }, {}))).resolves.toBe(
      false,
    );
  });

  it('does not mark a chaos mock applied when an earlier hook owns the mock slot', async () => {
    const controller = new RuntimeChaosController();
    const adapter = createRuntimeChaosAdapter(controller);
    const receipt = await adapter.inject(
      contextFor({ type: 'drop' }, { apiName: 'search', phase: 'before_tool_call' }),
    );
    const mock = vi.fn(() => false);
    await createBeforeToolCallChaosHandler(controller)({
      apiName: 'search',
      callIndex: 0,
      mock,
      operationId: 'op-claimed',
      stepIndex: 1,
    });
    expect(mock).toHaveBeenCalledOnce();
    await expect(adapter.verifyInjection!(receipt, contextFor({ type: 'drop' }, {}))).resolves.toBe(
      false,
    );
  });

  it('releases a losing mock reservation for a later eligible call', async () => {
    const controller = new RuntimeChaosController();
    const adapter = createRuntimeChaosAdapter(controller);
    const receipt = await adapter.inject(
      contextFor(
        { type: 'drop' },
        { apiName: 'search', phase: 'before_tool_call' },
        { maxInjections: 1 },
      ),
    );
    const handler = createBeforeToolCallChaosHandler(controller);
    const point = {
      apiName: 'search',
      callIndex: 0,
      operationId: 'op-reservation',
      stepIndex: 1,
    };
    await handler({ ...point, mock: vi.fn(() => false) });
    const acceptedMock = vi.fn(() => true);
    await handler({ ...point, callIndex: 1, mock: acceptedMock });
    expect(acceptedMock).toHaveBeenCalledOnce();
    await expect(adapter.verifyInjection!(receipt, contextFor({ type: 'drop' }, {}))).resolves.toBe(
      true,
    );
  });

  it('does not activate an effect unsupported by the matched phase', async () => {
    const controller = new RuntimeChaosController();
    const adapter = createRuntimeChaosAdapter(controller);
    const receipt = await adapter.inject(
      contextFor(
        { content: 'unused', type: 'replace_result' },
        { operationId: 'op-1', phase: 'completion' },
      ),
    );
    const deliver = vi.fn(async () => {});
    await deliverCompletionWithChaos(
      controller,
      { operationId: 'op-1', payload: undefined },
      deliver,
    );
    await expect(adapter.verifyInjection!(receipt, contextFor({ type: 'drop' }, {}))).resolves.toBe(
      false,
    );
    expect(deliver).toHaveBeenCalledOnce();
  });

  it('injects a retryable failure through the production retry helper', async () => {
    const controller = new RuntimeChaosController();
    await createRuntimeChaosAdapter(controller).inject(
      contextFor(
        { errorType: 'RateLimited', type: 'throw' },
        { apiName: 'search', phase: 'tool_attempt' },
        { maxInjections: 1 },
      ),
    );
    const execute = vi.fn(async () => ({ content: 'success', success: true }));
    const point = { apiName: 'search', callIndex: 0, operationId: 'op-1', stepIndex: 1 };
    const result = await executeToolWithRetry(
      () => executeToolAttemptWithChaos(controller, point, execute),
      { maxRetries: 1 },
    );
    expect(result).toEqual({
      attempts: 2,
      result: { content: 'success', success: true },
    });
    expect(execute).toHaveBeenCalledOnce();
  });

  it('mocks a canceled result when a beforeToolCall delay is disarmed', async () => {
    const controller = new RuntimeChaosController();
    const adapter = createRuntimeChaosAdapter(controller);
    const receipt = await adapter.inject(
      contextFor(
        { durationMs: 60_000, type: 'delay' },
        { apiName: 'search', phase: 'before_tool_call' },
      ),
    );
    const mock = vi.fn();
    const pending = createBeforeToolCallChaosHandler(controller)({
      apiName: 'search',
      callIndex: 0,
      mock,
      operationId: 'op-1',
      stepIndex: 1,
    });
    await adapter.cleanup!(receipt, contextFor({ type: 'drop' }, {}));
    await expect(pending).resolves.toBeUndefined();
    expect(mock).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ errorType: 'Canceled', kind: 'stop' }),
        success: false,
      }),
    );
  });

  it('stops without retrying a tool attempt when its delay is disarmed', async () => {
    const controller = new RuntimeChaosController();
    const adapter = createRuntimeChaosAdapter(controller);
    const receipt = await adapter.inject(
      contextFor(
        { durationMs: 60_000, type: 'delay' },
        { apiName: 'search', phase: 'tool_attempt' },
      ),
    );
    const execute = vi.fn(async () => ({ content: 'success', success: true }));
    const point = { apiName: 'search', callIndex: 0, operationId: 'op-1', stepIndex: 1 };
    const pending = executeToolWithRetry(
      () => executeToolAttemptWithChaos(controller, point, execute),
      { maxRetries: 1 },
    );
    await adapter.cleanup!(receipt, contextFor({ type: 'drop' }, {}));
    const result = await pending;
    expect(result.attempts).toBe(1);
    expect(result.result).toEqual(
      expect.objectContaining({ error: expect.objectContaining({ kind: 'stop' }), success: false }),
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it('duplicates a completion delivery exactly as configured', async () => {
    const controller = new RuntimeChaosController();
    await createRuntimeChaosAdapter(controller).inject(
      contextFor(
        { count: 2, type: 'duplicate' },
        { operationId: 'op-duplicate', phase: 'completion' },
      ),
    );
    const deliver = vi.fn(async () => {});
    await deliverCompletionWithChaos(
      controller,
      { operationId: 'op-duplicate', payload: {} },
      deliver,
    );
    expect(deliver).toHaveBeenCalledTimes(2);
  });

  it('applies only one winner when completion faults overlap', async () => {
    const controller = new RuntimeChaosController();
    const adapter = createRuntimeChaosAdapter(controller);
    const duplicateReceipt = await adapter.inject(
      contextFor(
        { count: 2, type: 'duplicate' },
        { operationId: 'op-conflict', phase: 'completion' },
        { runId: 'run-duplicate' },
      ),
    );
    const dropReceipt = await adapter.inject(
      contextFor(
        { type: 'drop' },
        { operationId: 'op-conflict', phase: 'completion' },
        { runId: 'run-drop' },
      ),
    );
    const deliver = vi.fn(async () => {});
    await deliverCompletionWithChaos(
      controller,
      { operationId: 'op-conflict', payload: {} },
      deliver,
    );
    expect(deliver).toHaveBeenCalledTimes(2);
    await expect(
      adapter.verifyInjection!(duplicateReceipt, contextFor({ type: 'drop' }, {})),
    ).resolves.toBe(true);
    await expect(
      adapter.verifyInjection!(dropReceipt, contextFor({ type: 'drop' }, {})),
    ).resolves.toBe(false);
  });

  it('cancels a delayed completion when the runtime fault is disarmed', async () => {
    const parent = new AbortController();
    const controller = new RuntimeChaosController();
    const adapter = createRuntimeChaosAdapter(controller);
    const receipt = await adapter.inject(
      contextFor(
        { durationMs: 60_000, type: 'delay' },
        { operationId: 'op-delayed', phase: 'completion' },
        { signal: parent.signal },
      ),
    );
    const deliver = vi.fn(async () => {});
    const pending = deliverCompletionWithChaos(
      controller,
      { operationId: 'op-delayed', payload: {} },
      deliver,
    );
    await adapter.cleanup!(receipt, contextFor({ type: 'drop' }, {}));
    await expect(pending).rejects.toThrow('Chaos fault disarmed');
    expect(deliver).not.toHaveBeenCalled();
  });
});
