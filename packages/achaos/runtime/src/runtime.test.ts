import type { ChaosExperiment, ChaosRunContext } from '@achaos/core';
import { createSeededRandom } from '@achaos/core';
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
    });
  });

  it('injects one failure inside the retry attempt and honors maxInjections', async () => {
    const controller = new RuntimeChaosController();
    await createRuntimeChaosAdapter(controller).inject(
      contextFor(
        { errorType: 'RateLimited', type: 'throw' },
        { apiName: 'search', phase: 'tool_attempt' },
        { maxInjections: 1 },
      ),
    );
    const execute = vi.fn(async () => 'success');
    const point = { apiName: 'search', callIndex: 0, operationId: 'op-1', stepIndex: 1 };
    await expect(executeToolAttemptWithChaos(controller, point, execute)).rejects.toThrow(
      'RateLimited',
    );
    await expect(executeToolAttemptWithChaos(controller, point, execute)).resolves.toBe('success');
    expect(execute).toHaveBeenCalledOnce();
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
