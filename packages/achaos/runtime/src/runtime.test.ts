import type { ChaosExperiment, ChaosRunContext } from '@achaos/core';
import { createSeededRandom } from '@achaos/core';
import { executeToolWithRetry } from '@lobechat/agent-runtime/src/utils/runtimeRetry';
import { describe, expect, it, vi } from 'vitest';

import { createRuntimeChaosAdapter } from './adapter';
import { deliverCompletionWithChaos } from './completion';
import { RuntimeChaosController } from './controller';
import { executeToolAttemptWithChaos } from './toolAttempt';
import { createBeforeToolCallChaosHandler } from './toolHook';

const contextFor = (
  effect: ChaosExperiment['effect'],
  selector: Record<string, unknown>,
  options?: { maxInjections?: number; signal?: AbortSignal },
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
  runId: 'run-runtime',
  signal: options?.signal ?? new AbortController().signal,
});

describe('runtime chaos adapter', () => {
  it('injects deterministic result replacement through beforeToolCall', async () => {
    const controller = new RuntimeChaosController();
    const adapter = createRuntimeChaosAdapter(controller);
    await adapter.inject(
      contextFor({ content: '{"ok":false}', type: 'replace_result' }, { apiName: 'search' }),
    );
    const mock = vi.fn();
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
