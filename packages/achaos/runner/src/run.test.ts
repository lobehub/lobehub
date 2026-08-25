import type { ChaosExperiment } from '@achaos/core';
import { describe, expect, it, vi } from 'vitest';

import { ChaosRegistry } from './registry';
import { runChaosExperiment } from './run';

const experiment: ChaosExperiment = {
  cleanup: 'always',
  description: 'test experiment',
  effect: { errorType: 'Timeout', type: 'throw' },
  id: 'test-experiment',
  layer: 'L1-model-runtime',
  oracles: [{ name: 'healthy' }],
  safety: { allowedEnvironments: ['test'] },
  seed: 'seed',
  target: { adapter: 'test', selector: {} },
  timeoutMs: 100,
  trigger: { when: 'immediate' },
};

describe('runChaosExperiment', () => {
  it('runs injection, exercise, oracle and cleanup with a structured timeline', async () => {
    const cleanup = vi.fn(async () => {});
    const registry = new ChaosRegistry()
      .registerAdapter({
        cleanup,
        inject: async ({ runId }) => ({ adapter: 'test', injectionId: runId }),
        name: 'test',
      })
      .registerOracle({
        evaluate: async () => ({ message: 'healthy', name: 'healthy', status: 'passed' }),
        name: 'healthy',
      });
    const result = await runChaosExperiment({
      environment: 'test',
      exercise: async () => {},
      experiment,
      registry,
      runId: 'run-1',
    });
    expect(result.status).toBe('passed');
    expect(result.timeline.map(({ type }) => type)).toEqual([
      'run_started',
      'fault_injected',
      'system_exercised',
      'oracle_evaluated',
      'cleanup_started',
      'cleanup_completed',
      'run_completed',
    ]);
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('defaults programmatic experiments to always cleanup', async () => {
    const cleanup = vi.fn(async () => {});
    const registry = new ChaosRegistry()
      .registerAdapter({
        cleanup,
        inject: async ({ runId }) => ({ adapter: 'test', injectionId: runId }),
        name: 'test',
      })
      .registerOracle({
        evaluate: async () => ({ message: 'healthy', name: 'healthy', status: 'passed' }),
        name: 'healthy',
      });
    const { cleanup: _cleanup, ...withoutCleanup } = experiment;
    await runChaosExperiment({ environment: 'test', experiment: withoutCleanup, registry });
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('does not run on_success cleanup when an oracle fails', async () => {
    const cleanup = vi.fn(async () => {});
    const registry = new ChaosRegistry()
      .registerAdapter({
        cleanup,
        inject: async ({ runId }) => ({ adapter: 'test', injectionId: runId }),
        name: 'test',
      })
      .registerOracle({
        evaluate: async () => ({ message: 'unhealthy', name: 'healthy', status: 'failed' }),
        name: 'healthy',
      });
    const result = await runChaosExperiment({
      environment: 'test',
      experiment: { ...experiment, cleanup: 'on_success' },
      registry,
    });
    expect(result.status).toBe('failed');
    expect(cleanup).not.toHaveBeenCalled();
  });

  it('blocks environments outside the blast-radius policy', async () => {
    const registry = new ChaosRegistry().registerAdapter({ inject: vi.fn(), name: 'test' });
    const result = await runChaosExperiment({ environment: 'production', experiment, registry });
    expect(result.status).toBe('aborted');
    expect(result.error?.name).toBe('ChaosSafetyError');
  });

  it('rejects a programmatic experiment without an oracle', async () => {
    const registry = new ChaosRegistry().registerAdapter({ inject: vi.fn(), name: 'test' });
    const result = await runChaosExperiment({
      environment: 'test',
      experiment: { ...experiment, oracles: [] },
      registry,
    });
    expect(result.status).toBe('aborted');
    expect(result.error?.name).toBe('ChaosConfigError');
  });

  it('reports an unselected probabilistic trigger as inconclusive', async () => {
    const inject = vi.fn();
    const registry = new ChaosRegistry().registerAdapter({ inject, name: 'test' });
    const result = await runChaosExperiment({
      environment: 'test',
      experiment: { ...experiment, trigger: { probability: 0, when: 'immediate' } },
      registry,
    });
    expect(result.status).toBe('inconclusive');
    expect(inject).not.toHaveBeenCalled();
  });

  it('honors an after trigger by exercising the system before injection', async () => {
    const order: string[] = [];
    const registry = new ChaosRegistry()
      .registerAdapter({
        inject: async ({ runId }) => {
          order.push('inject');
          return { adapter: 'test', injectionId: runId };
        },
        name: 'test',
      })
      .registerOracle({
        evaluate: async () => ({ message: 'healthy', name: 'healthy', status: 'passed' }),
        name: 'healthy',
      });
    await runChaosExperiment({
      environment: 'test',
      exercise: async () => {
        order.push('exercise');
      },
      experiment: { ...experiment, trigger: { when: 'after' } },
      registry,
    });
    expect(order).toEqual(['exercise', 'inject']);
  });

  it('aborts a timed-out phase and gives cleanup a fresh signal', async () => {
    let phaseWasAborted = false;
    let cleanupWasAborted = true;
    const registry = new ChaosRegistry().registerAdapter({
      cleanup: async (_receipt, context) => {
        cleanupWasAborted = context.signal.aborted;
      },
      inject: async (context) => ({ adapter: 'test', injectionId: context.runId }),
      name: 'test',
    });
    const result = await runChaosExperiment({
      environment: 'test',
      exercise: async (context) =>
        new Promise<void>((resolve) => {
          context.signal.addEventListener(
            'abort',
            () => {
              phaseWasAborted = true;
              resolve();
            },
            { once: true },
          );
        }),
      experiment: { ...experiment, timeoutMs: 5 },
      registry,
    });
    expect(result.status).toBe('failed');
    expect(phaseWasAborted).toBe(true);
    expect(cleanupWasAborted).toBe(false);
  });
});
