import type {
  DashboardWidgetRunError,
  DashboardWidgetRunFinalStatus,
  WidgetOutput,
} from '@lobechat/types';
import debug from 'debug';

import { DashboardWidgetModel } from '@/database/models/dashboardWidget';
import type {
  DashboardWidgetRow,
  DashboardWidgetRunRow,
  DashboardWidgetVersionRow,
} from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { MissingWidgetEnvError, resolveWidgetEnv, type WidgetCredentialScope } from './credentials';
import { recordWidgetMetrics } from './metrics';
import { parseWidgetOutput } from './outputContract';
import { redactSecrets, sanitizeStream } from './redact';
import { DashboardSandboxError, type DashboardSandboxRunner } from './sandboxRunner';

const log = debug('lobe-server:dashboard:execute-run');

/** How much of stderr a NON_ZERO_EXIT error message quotes. */
const ERROR_STDERR_TAIL = 500;

export type ResolveWidgetEnv = (
  db: LobeChatDatabase,
  scope: WidgetCredentialScope,
  requirements: NonNullable<DashboardWidgetVersionRow['manifest']>['env'],
) => Promise<Record<string, string>>;

export interface ExecuteWidgetRunDeps {
  resolveEnv?: ResolveWidgetEnv;
  runner: Pick<DashboardSandboxRunner, 'run'>;
}

export interface ExecuteWidgetRunParams {
  run: Pick<DashboardWidgetRunRow, 'id' | 'trigger'>;
  version: Pick<DashboardWidgetVersionRow, 'manifest' | 'outputType' | 'runtime' | 'script'>;
  widget: Pick<
    DashboardWidgetRow,
    'agentId' | 'id' | 'metricId' | 'projectId' | 'title' | 'userId' | 'workspaceId'
  >;
}

interface RunOutcome {
  durationMs?: number;
  error?: DashboardWidgetRunError | null;
  exitCode?: number | null;
  output?: WidgetOutput | null;
  partial?: boolean;
  status: DashboardWidgetRunFinalStatus;
  stderr?: string | null;
  stdout?: string | null;
}

/**
 * Execute one opened run end to end and close it:
 *
 * 1. resolve the declared env from the widget's connector scope — a missing
 *    required variable fails the run with `MISSING_ENV` before any sandbox call;
 * 2. execute the version's script on the sandbox Worker;
 * 3. redact injected secrets (and well-known token shapes) from stdout / stderr
 *    before anything is parsed or persisted, then truncate the streams;
 * 4. judge the result — timeout → `timeout`; non-zero exit → `NON_ZERO_EXIT`;
 *    stdout not matching the contract → the contract's error code; a valid
 *    output with `meta.complete === false` succeeds as a partial result;
 * 5. finish the run. For non-preview runs `finishRun` folds the result into
 *    the widget: success replaces `latestOutput` and resets the failure
 *    streak, failure keeps the last good output and increments it;
 * 6. a complete, successful non-preview run appends its numbers to the
 *    widget's metric trend.
 *
 * Never throws for script or sandbox failures — they become the run's status.
 */
export const executeWidgetRun = async (
  db: LobeChatDatabase,
  params: ExecuteWidgetRunParams,
  deps: ExecuteWidgetRunDeps,
): Promise<DashboardWidgetRunRow | undefined> => {
  const { run, version, widget } = params;
  const manifest = version.manifest ?? undefined;
  const resolveEnv = deps.resolveEnv ?? resolveWidgetEnv;

  const outcome = await (async (): Promise<RunOutcome & { env: Record<string, string> }> => {
    let env: Record<string, string>;
    try {
      env = await resolveEnv(db, widget, manifest?.env);
    } catch (error) {
      if (error instanceof MissingWidgetEnvError) {
        return {
          env: {},
          error: { code: 'MISSING_ENV', message: error.message },
          status: 'failed',
        };
      }
      // Anything else (key vault misconfigured, DB hiccup) must still close the
      // run — an exception here would strand it in `running` forever.
      console.error(
        '[dashboard:executeRun] credential resolution failed widget=%s',
        widget.id,
        error,
      );
      return {
        env: {},
        error: { code: 'CREDENTIALS_ERROR', message: 'Failed to resolve widget credentials' },
        status: 'failed',
      };
    }

    try {
      const result = await deps.runner.run({
        env,
        network: (manifest?.network?.allow?.length ?? 0) > 0,
        runtime: version.runtime,
        script: version.script,
        timeoutMs: manifest?.timeoutMs,
      });

      const stdout = redactSecrets(result.stdout, env);
      const stderr = redactSecrets(result.stderr, env);
      const base = {
        durationMs: result.durationMs,
        env,
        exitCode: result.exitCode,
        stderr,
        stdout,
      };

      if (result.timedOut) {
        return {
          ...base,
          error: { code: 'TIMEOUT', message: 'Script exceeded its time limit' },
          status: 'timeout',
        };
      }
      if (result.exitCode !== 0) {
        const tail = stderr.trim().slice(-ERROR_STDERR_TAIL);
        return {
          ...base,
          error: {
            code: 'NON_ZERO_EXIT',
            message: `Script exited with code ${result.exitCode}${tail ? `: ${tail}` : ''}`,
          },
          status: 'failed',
        };
      }

      const parsed = parseWidgetOutput(stdout, version.outputType);
      if (!parsed.ok) {
        return { ...base, error: { code: parsed.code, message: parsed.message }, status: 'failed' };
      }
      return {
        ...base,
        error: parsed.partial
          ? {
              code: 'PARTIAL_OUTPUT',
              message: parsed.partialMessage ?? 'Script reported an incomplete result',
            }
          : null,
        output: parsed.output,
        partial: parsed.partial,
        status: 'succeeded',
      };
    } catch (error) {
      if (error instanceof DashboardSandboxError) {
        return {
          env,
          error: { code: error.code, message: redactSecrets(error.message, env) },
          status: 'failed',
        };
      }
      const message = error instanceof Error ? error.message : String(error);
      return {
        env,
        error: { code: 'SANDBOX_ERROR', message: redactSecrets(message, env) },
        status: 'failed',
      };
    }
  })();

  const finishedAt = new Date();
  const finished = await DashboardWidgetModel.finishRun(db, run.id, {
    durationMs: outcome.durationMs ?? null,
    error: outcome.error ?? null,
    exitCode: outcome.exitCode ?? null,
    finishedAt,
    output: outcome.output ?? null,
    status: outcome.status,
    stderr: outcome.stderr ? sanitizeStream(outcome.stderr, outcome.env) : null,
    stdout: outcome.stdout ? sanitizeStream(outcome.stdout, outcome.env) : null,
  });

  if (
    finished &&
    run.trigger !== 'preview' &&
    outcome.status === 'succeeded' &&
    !outcome.partial &&
    outcome.output
  ) {
    try {
      const { primaryMetricId } = await recordWidgetMetrics(db, widget, {
        manifest,
        observedAt: finishedAt,
        output: outcome.output,
        runId: run.id,
      });
      if (primaryMetricId && primaryMetricId !== widget.metricId) {
        await DashboardWidgetModel.linkMetric(db, widget.id, primaryMetricId);
      }
    } catch (error) {
      // The run itself succeeded; a trend write failure must not flip it.
      console.error('[dashboard:executeRun] failed to record metrics widget=%s', widget.id, error);
    }
  }

  log('run=%s widget=%s status=%s', run.id, widget.id, outcome.status);
  return finished;
};
