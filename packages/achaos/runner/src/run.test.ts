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

const withHealthyOracle = (registry: ChaosRegistry) =>
  registry.registerOracle({
    evaluate: async () => ({ message: 'healthy', name: 'healthy', status: 'passed' }),
    name: 'healthy',
  });

describe('runChaosExperiment', () => {
  it('runs injection, exercise, oracle and cleanup with a structured timeline', async () => {
    const cleanup = vi.fn(async () => {});
    const registry = new ChaosRegistry()
      .registerAdapter({
        cancelInjection: async () => {},
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
        cancelInjection: async () => {},
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
        cancelInjection: async () => {},
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

  it('requires explicit external approval for production', async () => {
    const inject = vi.fn(async () => ({ adapter: 'test', injectionId: 'production' }));
    const registry = new ChaosRegistry().registerAdapter({ inject, name: 'test' }).registerOracle({
      evaluate: async () => ({ message: 'healthy', name: 'healthy', status: 'passed' }),
      name: 'healthy',
    });
    const productionExperiment: ChaosExperiment = {
      ...experiment,
      cleanup: 'never',
      safety: { allowedEnvironments: ['production'] },
    };
    const blocked = await runChaosExperiment({
      environment: 'production',
      experiment: productionExperiment,
      registry,
    });
    expect(blocked.status).toBe('aborted');
    expect(blocked.error?.name).toBe('ChaosApprovalError');
    expect(inject).not.toHaveBeenCalled();

    const approveProduction = vi.fn(async () => true);
    const approved = await runChaosExperiment({
      approveProduction,
      environment: 'production',
      experiment: productionExperiment,
      registry,
    });
    expect(approved.status).toBe('passed');
    expect(approveProduction).toHaveBeenCalledOnce();
    expect(inject).toHaveBeenCalledOnce();

    const startedAt = Date.now();
    const timedOut = await runChaosExperiment({
      approveProduction: async () => new Promise<boolean>(() => {}),
      environment: 'production',
      experiment: { ...productionExperiment, timeoutMs: 5 },
      registry,
    });
    expect(timedOut.status).toBe('aborted');
    expect(Date.now() - startedAt).toBeLessThan(1000);
    expect(inject).toHaveBeenCalledOnce();
  });

  it('treats unknown production aliases conservatively', async () => {
    const inject = vi.fn();
    const registry = withHealthyOracle(
      new ChaosRegistry().registerAdapter({ inject, name: 'test' }),
    );
    const result = await runChaosExperiment({
      environment: 'live',
      experiment: { ...experiment, safety: { allowedEnvironments: ['live'] } },
      registry,
    });
    expect(result.status).toBe('aborted');
    expect(result.error?.name).toBe('ChaosApprovalError');
    expect(inject).not.toHaveBeenCalled();
  });

  it('fails when an adapter reports that its fault never activated', async () => {
    const cleanup = vi.fn(async () => {});
    const registry = withHealthyOracle(
      new ChaosRegistry().registerAdapter({
        cancelInjection: async () => {},
        cleanup,
        inject: async () => ({ adapter: 'test', injectionId: 'inactive' }),
        name: 'test',
        verifyInjection: async () => false,
      }),
    );
    const result = await runChaosExperiment({ environment: 'test', experiment, registry });
    expect(result.status).toBe('failed');
    expect(result.error?.name).toBe('ChaosInjectionNotActivatedError');
    expect(cleanup).toHaveBeenCalledOnce();
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

  it('validates numeric constraints on programmatic experiments', async () => {
    const inject = vi.fn();
    const registry = new ChaosRegistry().registerAdapter({ inject, name: 'test' });
    const result = await runChaosExperiment({
      environment: 'test',
      experiment: {
        ...experiment,
        effect: { count: 0, type: 'duplicate' },
      } as ChaosExperiment,
      registry,
    });
    expect(result.status).toBe('aborted');
    expect(result.error?.name).toBe('ChaosConfigError');
    expect(inject).not.toHaveBeenCalled();
  });

  it('returns a structured configuration failure for an unknown adapter', async () => {
    const result = await runChaosExperiment({
      environment: 'test',
      experiment,
      registry: new ChaosRegistry(),
    });
    expect(result.status).toBe('aborted');
    expect(result.error?.name).toBe('ChaosConfigError');
    expect(result.timeline.at(-1)).toEqual(
      expect.objectContaining({
        data: { reason: 'adapter_not_registered' },
        type: 'run_completed',
      }),
    );
  });

  it('preflights oracle registrations before injecting a fault', async () => {
    const inject = vi.fn(async () => ({ adapter: 'process', injectionId: 'destructive' }));
    const registry = new ChaosRegistry().registerAdapter({ inject, name: 'test' });
    const result = await runChaosExperiment({
      environment: 'test',
      experiment: { ...experiment, cleanup: 'never' },
      registry,
    });
    expect(result.status).toBe('aborted');
    expect(result.error?.name).toBe('ChaosConfigError');
    expect(inject).not.toHaveBeenCalled();
  });

  it('rejects cleanup adapters without a cancellable injection contract', async () => {
    const inject = vi.fn();
    const registry = new ChaosRegistry().registerAdapter({
      cleanup: async () => {},
      inject,
      name: 'test',
    });
    const result = await runChaosExperiment({ environment: 'test', experiment, registry });
    expect(result.status).toBe('aborted');
    expect(result.error?.name).toBe('ChaosConfigError');
    expect(inject).not.toHaveBeenCalled();
  });

  it('rejects cleanup policies unsupported by an irreversible adapter', async () => {
    const inject = vi.fn();
    const registry = new ChaosRegistry().registerAdapter({ inject, name: 'test' });
    const result = await runChaosExperiment({ environment: 'test', experiment, registry });
    expect(result.status).toBe('aborted');
    expect(result.error?.name).toBe('ChaosConfigError');
    expect(inject).not.toHaveBeenCalled();
  });

  it('reports an unselected probabilistic trigger as inconclusive', async () => {
    const inject = vi.fn();
    const registry = withHealthyOracle(
      new ChaosRegistry().registerAdapter({ inject, name: 'test' }),
    );
    const result = await runChaosExperiment({
      environment: 'test',
      experiment: {
        ...experiment,
        cleanup: 'never',
        trigger: { probability: 0, when: 'immediate' },
      },
      registry,
    });
    expect(result.status).toBe('inconclusive');
    expect(inject).not.toHaveBeenCalled();
  });

  it('reports broken registrations before probabilistic sampling', async () => {
    const result = await runChaosExperiment({
      environment: 'test',
      experiment: { ...experiment, trigger: { probability: 0, when: 'immediate' } },
      registry: new ChaosRegistry(),
    });
    expect(result.status).toBe('aborted');
    expect(result.error?.name).toBe('ChaosConfigError');
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
      experiment: { ...experiment, cleanup: 'never', trigger: { when: 'after' } },
      registry,
    });
    expect(order).toEqual(['exercise', 'inject']);
  });

  it('passes each oracle specification to its evaluator', async () => {
    const evaluate = vi.fn(async () => ({
      message: 'healthy',
      name: 'healthy',
      status: 'passed' as const,
    }));
    const registry = new ChaosRegistry()
      .registerAdapter({
        inject: async () => ({ adapter: 'test', injectionId: 'params' }),
        name: 'test',
      })
      .registerOracle({ evaluate, name: 'healthy' });
    const oracle = { name: 'healthy', params: { recoveryBoundMs: 500 } };
    await runChaosExperiment({
      environment: 'test',
      experiment: { ...experiment, cleanup: 'never', oracles: [oracle] },
      registry,
    });
    expect(evaluate).toHaveBeenCalledWith(expect.any(Object), oracle);
  });

  it('aborts a timed-out phase and gives cleanup a fresh signal', async () => {
    let phaseWasAborted = false;
    let cleanupWasAborted = true;
    const registry = withHealthyOracle(
      new ChaosRegistry().registerAdapter({
        cancelInjection: async () => {},
        cleanup: async (_receipt, context) => {
          cleanupWasAborted = context.signal.aborted;
        },
        inject: async (context) => ({ adapter: 'test', injectionId: context.runId }),
        name: 'test',
      }),
    );
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

  it('cancels an injection that would otherwise commit after its timeout', async () => {
    let canceled = false;
    let mutationCommitted = false;
    const cleanup = vi.fn(async () => {});
    const registry = withHealthyOracle(
      new ChaosRegistry().registerAdapter({
        cancelInjection: async () => {
          canceled = true;
        },
        cleanup,
        inject: async (context) => {
          await new Promise((resolve) => setTimeout(resolve, 15));
          if (canceled) throw new Error('mutation canceled');
          mutationCommitted = true;
          return { adapter: 'test', injectionId: context.runId };
        },
        name: 'test',
      }),
    );
    const result = await runChaosExperiment({
      environment: 'test',
      experiment: { ...experiment, timeoutMs: 10 },
      registry,
    });
    expect(result.status).toBe('failed');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(canceled).toBe(true);
    expect(mutationCommitted).toBe(false);
    expect(cleanup).not.toHaveBeenCalled();
    expect(result.injection).toBeUndefined();
  });

  it('bounds cancellation when a timed-out injection never settles', async () => {
    const cancelInjection = vi.fn(async () => {});
    const cleanup = vi.fn(async () => {});
    const registry = withHealthyOracle(
      new ChaosRegistry().registerAdapter({
        cancelInjection,
        cleanup,
        inject: async () => new Promise<never>(() => {}),
        name: 'test',
      }),
    );
    const startedAt = Date.now();
    const result = await runChaosExperiment({
      environment: 'test',
      experiment: { ...experiment, timeoutMs: 5 },
      registry,
    });
    expect(result.status).toBe('failed');
    expect(Date.now() - startedAt).toBeLessThan(1000);
    expect(cancelInjection).toHaveBeenCalledOnce();
    expect(cleanup).not.toHaveBeenCalled();
  });

  it('preserves both a phase failure and a cleanup failure', async () => {
    const registry = withHealthyOracle(
      new ChaosRegistry().registerAdapter({
        cancelInjection: async () => {},
        cleanup: async () => {
          throw new Error('restore failed');
        },
        inject: async () => ({ adapter: 'test', injectionId: 'aggregate' }),
        name: 'test',
      }),
    );
    const result = await runChaosExperiment({
      environment: 'test',
      exercise: async () => {
        throw new Error('exercise failed');
      },
      experiment,
      registry,
    });
    expect(result.status).toBe('failed');
    expect(result.error?.name).toBe('ChaosAggregateError');
    expect(result.error?.message).toContain('exercise failed');
    expect(result.error?.message).toContain('restore failed');
  });
});
