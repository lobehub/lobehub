import { randomUUID } from 'node:crypto';

import type {
  ChaosAdapter,
  ChaosExercise,
  ChaosExperiment,
  ChaosOracleResult,
  ChaosRunContext,
  ChaosRunResult,
  ChaosTimelineEvent,
  ChaosTimelineEventType,
} from '@achaos/core';
import { chaosExperimentSchema, createSeededRandom } from '@achaos/core';

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
  approveProduction?: (context: ChaosRunContext) => Promise<boolean>;
  environment: string;
  exercise?: ChaosExercise;
  experiment: ChaosExperiment;
  now?: () => Date;
  registry: ChaosRegistry;
  runId?: string;
}

export const runChaosExperiment = async ({
  approveProduction,
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

  record('run_started', { environment });

  const parsedExperiment = chaosExperimentSchema.safeParse(experiment);
  if (!parsedExperiment.success) {
    const finishedAt = now();
    record('run_completed', { reason: 'invalid_experiment' });
    return {
      durationMs: finishedAt.getTime() - started.getTime(),
      error: { message: parsedExperiment.error.message, name: 'ChaosConfigError' },
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
  experiment = parsedExperiment.data;

  const context: ChaosRunContext = {
    environment,
    experiment,
    random: createSeededRandom(experiment.seed),
    runId,
    signal: controller.signal,
  };

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

  if (environment === 'production') {
    const approved = approveProduction
      ? await withTimeout(approveProduction(context), experiment.timeoutMs, controller).catch(
          () => false,
        )
      : false;
    if (!approved) {
      const finishedAt = now();
      record('run_completed', { reason: 'production_approval_required' });
      return {
        durationMs: finishedAt.getTime() - started.getTime(),
        error: {
          message: 'Production chaos requires explicit external approval',
          name: 'ChaosApprovalError',
        },
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
  }

  if (experiment.oracles.length === 0) {
    const finishedAt = now();
    record('run_completed', { reason: 'oracle_required' });
    return {
      durationMs: finishedAt.getTime() - started.getTime(),
      error: { message: 'Chaos experiments require at least one oracle', name: 'ChaosConfigError' },
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

  const probability = experiment.trigger.probability ?? 1;
  if (context.random() >= probability) {
    const finishedAt = now();
    record('run_completed', { reason: 'trigger_not_selected', status: 'inconclusive' });
    controller.abort('chaos_run_skipped');
    return {
      durationMs: finishedAt.getTime() - started.getTime(),
      experimentId: experiment.id,
      finishedAt: finishedAt.toISOString(),
      oracleResults,
      runId,
      seed: experiment.seed,
      startedAt: started.toISOString(),
      status: 'inconclusive',
      timeline,
    };
  }

  let adapter: ChaosAdapter;
  try {
    adapter = registry.resolveAdapter(experiment.target.adapter);
  } catch (adapterError) {
    const finishedAt = now();
    record('run_completed', { reason: 'adapter_not_registered' });
    return {
      durationMs: finishedAt.getTime() - started.getTime(),
      error: { ...serializeError(adapterError), name: 'ChaosConfigError' },
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
  const cleanupPolicy = experiment.cleanup ?? 'always';
  let injection;
  let injectionPromise: ReturnType<typeof adapter.inject> | undefined;
  let error: unknown;

  try {
    const runExercise = async () => {
      if (!exercise) return;
      await withTimeout(exercise(context), experiment.timeoutMs, controller);
      record('system_exercised');
    };
    if (experiment.trigger.when === 'after') await runExercise();

    injectionPromise = adapter.inject(context);
    injection = await withTimeout(injectionPromise, experiment.timeoutMs, controller);
    record('fault_injected', { adapter: adapter.name, injectionId: injection.injectionId });

    if (experiment.trigger.when !== 'after') await runExercise();
    if (
      adapter.verifyInjection &&
      !(await withTimeout(
        adapter.verifyInjection(injection, context),
        experiment.timeoutMs,
        controller,
      ))
    ) {
      const activationError = new Error('Injected chaos fault did not activate');
      activationError.name = 'ChaosInjectionNotActivatedError';
      throw activationError;
    }
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
    if (!injection && injectionPromise && cleanupPolicy === 'always' && adapter.cleanup) {
      try {
        const reconciliationController = new AbortController();
        injection = await withTimeout(
          injectionPromise,
          experiment.timeoutMs,
          reconciliationController,
        );
      } catch {
        // A rejected or still-stuck injection produced no bounded receipt to reconcile.
      }
    }
    const oraclesPassed = oracleResults.every(({ status }) => status === 'passed');
    const shouldCleanup =
      injection &&
      adapter.cleanup &&
      (cleanupPolicy === 'always' || (cleanupPolicy === 'on_success' && !error && oraclesPassed));
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
        if (error) {
          const phaseFailure = serializeError(error);
          const cleanupFailure = serializeError(cleanupError);
          const aggregateError = new Error(
            `Chaos phase failed: ${phaseFailure.name}: ${phaseFailure.message}; cleanup also failed: ${cleanupFailure.name}: ${cleanupFailure.message}`,
          );
          aggregateError.name = 'ChaosAggregateError';
          error = aggregateError;
        } else {
          error = cleanupError;
        }
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
