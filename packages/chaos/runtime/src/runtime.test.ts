import type { ChaosExperiment, ChaosRunContext } from '@chaos/core';
import { createSeededRandom } from '@chaos/core';
import { describe, expect, it, vi } from 'vitest';

import { createRuntimeChaosAdapter } from './adapter';
import { deliverCompletionWithChaos } from './completion';
import { RuntimeChaosController } from './controller';
import { createBeforeToolCallChaosHandler } from './toolHook';

const contextFor = (
  effect: ChaosExperiment['effect'],
  selector: Record<string, unknown>,
): ChaosRunContext => ({
  environment: 'test',
  experiment: {
    cleanup: 'always',
    description: 'runtime fault',
    effect,
    id: 'runtime-fault',
    layer: 'L2-agent-runtime',
    oracles: [{ name: 'noop' }],
    safety: { allowedEnvironments: ['test'] },
    seed: 'seed',
    target: { adapter: 'runtime', selector },
    timeoutMs: 1000,
    trigger: { when: 'before' },
  },
  random: createSeededRandom('seed'),
  runId: 'run-runtime',
  signal: new AbortController().signal,
});

describe('runtime chaos adapter', () => {
  it('injects a deterministic tool failure through beforeToolCall', async () => {
    const controller = new RuntimeChaosController();
    const adapter = createRuntimeChaosAdapter(controller);
    await adapter.inject(
      contextFor({ errorType: 'RateLimited', type: 'throw' }, { apiName: 'search' }),
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
      content: JSON.stringify({ error: 'RateLimited', errorType: 'RateLimited' }),
    });
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
});
