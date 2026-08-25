import type { ChaosExperiment } from '@achaos/core';
import { ChaosRegistry, runChaosExperiment } from '@achaos/runner';
import { describe, expect, it } from 'vitest';

import {
  createAgentChaosTestState,
  createStateAdapter,
  createStateOracle,
  reclaimStaleOperation,
} from './state';

describe('first-phase deterministic scenarios', () => {
  it('reclaims a stale operation and verifies the invariant independently', async () => {
    const state = createAgentChaosTestState();
    const registry = new ChaosRegistry().registerAdapter(createStateAdapter(state)).registerOracle(
      createStateOracle(state, 'operation-reclaimed', (current) => ({
        message: `operation is ${current.operationStatus}`,
        passed: current.operationStatus === 'abandoned',
      })),
    );
    const experiment: ChaosExperiment = {
      cleanup: 'never',
      description: 'Reclaim an operation whose durable lease expired',
      effect: { durationMs: 300_000, type: 'delay' },
      id: 'operation-reclaim',
      layer: 'L2-agent-runtime',
      oracles: [{ name: 'operation-reclaimed' }],
      safety: { allowedEnvironments: ['test'] },
      seed: 'operation-reclaim-v1',
      target: { adapter: 'state', selector: { operationStatus: 'running' } },
      timeoutMs: 1000,
      trigger: { when: 'immediate' },
    };
    const result = await runChaosExperiment({
      environment: 'test',
      exercise: async () => reclaimStaleOperation(state),
      experiment,
      registry,
    });
    expect(result.status).toBe('passed');
    expect(state.operationLease).toBe('stale');
    expect(state.operationStatus).toBe('abandoned');
  });

  it('restores the prior tool result after an always-cleanup experiment', async () => {
    const state = createAgentChaosTestState();
    state.toolResult = 'baseline';
    const registry = new ChaosRegistry().registerAdapter(createStateAdapter(state)).registerOracle(
      createStateOracle(state, 'tool-failure-observed', (current) => ({
        message: current.toolResult ?? 'missing tool result',
        passed: current.toolResult?.includes('RateLimited') ?? false,
      })),
    );
    const experiment: ChaosExperiment = {
      cleanup: 'always',
      description: 'Inject a transient tool failure',
      effect: { errorType: 'RateLimited', type: 'throw' },
      id: 'tool-failure-cleanup',
      layer: 'L1-model-runtime',
      oracles: [{ name: 'tool-failure-observed' }],
      safety: { allowedEnvironments: ['test'] },
      seed: 'tool-failure-cleanup-v1',
      target: { adapter: 'state', selector: {} },
      timeoutMs: 1000,
      trigger: { when: 'immediate' },
    };
    const result = await runChaosExperiment({ environment: 'test', experiment, registry });
    expect(result.status).toBe('passed');
    expect(state.toolResult).toBe('baseline');
  });
});
