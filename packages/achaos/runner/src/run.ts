import { randomUUID } from 'node:crypto';

import type {
  ChaosExercise,
  ChaosExperiment,
  ChaosOracleResult,
  ChaosRunContext,
  ChaosRunResult,
  ChaosTimelineEvent,
  ChaosTimelineEventType,
} from '@achaos/core';
import { createSeededRandom } from '@achaos/core';

import type { ChaosRegistry } from './registry';

const serializeError = (error: unknown) => {
  if (error instanceof Error) return { message: error.message, name: error.name };
  return { message: String(error), name: 'Error' };
};

const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  controller: AbortController,
) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectOnAbort: (() => void) | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error(`Chaos phase timed out after ${timeoutMs}ms`);
          controller.abort(error);
          reject(error);
        }, timeoutMs);
        rejectOnAbort = () => reject(controller.signal.reason);
        controller.signal.addEventListener('abort', rejectOnAbort, { once: true });
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (rejectOnAbort) controller.signal.removeEventListener('abort', rejectOnAbort);
  }
};

export interface RunChaosExperimentOptions {
  environment: string;
  exercise?: ChaosExercise;
  experiment: ChaosExperiment;
  now?: () => Date;
  registry: ChaosRegistry;
  runId?: string;
}

export const runChaosExperiment = async ({
  environment,
  exercise,
  experiment,
  now = () => new Date(),
  registry,
  runId = randomUUID(),
}: RunChaosExperimentOptions): Promise<ChaosRunResult> => {
  const started = now();
  const timeline: ChaosTimelineEvent[] = [];
  const oracleResults: ChaosOracleResult[] = [];
  const controller = new AbortController();
  const record = (type: ChaosTimelineEventType, data?: Record<string, unknown>) =>
    timeline.push({ at: now().toISOString(), data, type });
  const context: ChaosRunContext = {
    environment,
    experiment,
    random: createSeededRandom(experiment.seed),
    runId,
    signal: controller.signal,
  };

  record('run_started', { environment });

  if (!experiment.safety.allowedEnvironments.includes(environment)) {
    const finishedAt = now();
    record('run_completed', { reason: 'environment_not_allowed' });
    return {
      durationMs: finishedAt.getTime() - started.getTime(),
      error: { message: `Environment ${environment} is not allowed`, name: 'ChaosSafetyError' },
      experimentId: experiment.id,
      finishedAt: finishedAt.toISOString(),
      oracleResults,
      runId,
      seed: experiment.seed,
      startedAt: started.toISOString(),
      status: 'aborted',
      timeline,
    };
  }

  const adapter = registry.resolveAdapter(experiment.target.adapter);
  let injection;
  let error: unknown;

  try {
    const probability = experiment.trigger.probability ?? 1;
    if (context.random() > probability)
      throw new Error('Deterministic trigger skipped the injection');
    const runExercise = async () => {
      if (!exercise) return;
      await withTimeout(exercise(context), experiment.timeoutMs, controller);
      record('system_exercised');
    };
    if (experiment.trigger.when === 'after') await runExercise();

    injection = await withTimeout(adapter.inject(context), experiment.timeoutMs, controller);
    record('fault_injected', { adapter: adapter.name, injectionId: injection.injectionId });

    if (experiment.trigger.when !== 'after') await runExercise();
    for (const spec of experiment.oracles) {
      const result = await withTimeout(
        registry.resolveOracle(spec.name).evaluate(context),
        spec.timeoutMs ?? experiment.timeoutMs,
        controller,
      );
      oracleResults.push(result);
      record('oracle_evaluated', { name: result.name, status: result.status });
    }
  } catch (caught) {
    error = caught;
  } finally {
    const shouldCleanup =
      injection &&
      adapter.cleanup &&
      (experiment.cleanup === 'always' || (experiment.cleanup === 'on_success' && !error));
    if (shouldCleanup) {
      record('cleanup_started');
      try {
        const cleanupController = new AbortController();
        await withTimeout(
          adapter.cleanup!(injection!, { ...context, signal: cleanupController.signal }),
          experiment.timeoutMs,
          cleanupController,
        );
        record('cleanup_completed');
      } catch (cleanupError) {
        error ??= cleanupError;
      }
    }
    controller.abort('chaos_run_completed');
  }

  const hasFailedOracle = oracleResults.some(({ status }) => status === 'failed');
  const hasInconclusiveOracle = oracleResults.some(({ status }) => status === 'inconclusive');
  const status =
    error || hasFailedOracle ? 'failed' : hasInconclusiveOracle ? 'inconclusive' : 'passed';
  const finishedAt = now();
  record('run_completed', { status });

  return {
    durationMs: finishedAt.getTime() - started.getTime(),
    ...(error ? { error: serializeError(error) } : {}),
    experimentId: experiment.id,
    finishedAt: finishedAt.toISOString(),
    ...(injection ? { injection } : {}),
    oracleResults,
    runId,
    seed: experiment.seed,
    startedAt: started.toISOString(),
    status,
    timeline,
  };
};
