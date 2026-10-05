import type { WidgetOutput, WidgetRunError, WidgetRunFinalStatus } from '@lobechat/types';
import debug from 'debug';

import { WidgetModel } from '@/database/models/widget';
import type { WidgetRow, WidgetRunRow, WidgetVersionRow } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import {
  ForbiddenWidgetCredentialsError,
  MissingWidgetEnvError,
  resolveWidgetEnv,
  type WidgetCredentialScope,
} from './credentials';
import { recordWidgetMetrics } from './metrics';
import { parseWidgetOutput } from './outputContract';
import { redactSecrets, sanitizeStream } from './redact';
import { WidgetSandboxError, type WidgetSandboxRunner } from './sandbox/types';

const log = debug('lobe-server:widget:execute-run');

/** How much of stderr a NON_ZERO_EXIT error message quotes. */
const ERROR_STDERR_TAIL = 500;

export type ResolveWidgetEnv = (
  db: LobeChatDatabase,
  scope: WidgetCredentialScope,
  requirements: NonNullable<WidgetVersionRow['manifest']>['env'],
) => Promise<Record<string, string>>;

export interface ExecuteWidgetRunDeps {
  resolveEnv?: ResolveWidgetEnv;
  runner: WidgetSandboxRunner;
}

export interface ExecuteWidgetRunParams {
  run: Pick<WidgetRunRow, 'id' | 'trigger'>;
  version: Pick<
    WidgetVersionRow,
    'manifest' | 'outputType' | 'publishedByUserId' | 'runtime' | 'script' | 'userId'
  >;
  widget: Pick<
    WidgetRow,
    'agentId' | 'id' | 'metricId' | 'projectId' | 'title' | 'userId' | 'workspaceId'
  >;
}

interface RunOutcome {
  durationMs?: number;
  env: Record<string, string>;
  error?: WidgetRunError | null;
  exitCode?: number | null;
  output?: WidgetOutput | null;
  status: WidgetRunFinalStatus;
  stderr?: string | null;
  stdout?: string | null;
}

/**
 * Resolve env, execute on the sandbox and judge the result. Never throws for
 * script or sandbox failures — they become the outcome's status.
 */
const runInSandbox = async (
  db: LobeChatDatabase,
  { version, widget }: Pick<ExecuteWidgetRunParams, 'version' | 'widget'>,
  deps: ExecuteWidgetRunDeps,
): Promise<RunOutcome> => {
  const manifest = version.manifest ?? undefined;
  const resolveEnv = deps.resolveEnv ?? resolveWidgetEnv;

  let env: Record<string, string>;
  try {
    // Secrets go to whoever wrote the script: the publisher of a live
    // version, the author of a draft.
    const authorUserId = version.publishedByUserId ?? version.userId;
    env = await resolveEnv(
      db,
      {
        agentId: widget.agentId,
        authorUserId,
        projectId: widget.projectId,
        userId: widget.userId,
        workspaceId: widget.workspaceId,
      },
      manifest?.env,
    );
  } catch (error) {
    if (error instanceof MissingWidgetEnvError) {
      return { env: {}, error: { code: 'MISSING_ENV', message: error.message }, status: 'failed' };
    }
    if (error instanceof ForbiddenWidgetCredentialsError) {
      return {
        env: {},
        error: { code: 'CREDENTIALS_FORBIDDEN', message: error.message },
        status: 'failed',
      };
    }
    // Anything else (key vault misconfigured, DB hiccup) must still close the
    // run — an exception here would strand it in `running` forever.
    console.error('[widget:executeRun] credential resolution failed widget=%s', widget.id, error);
    return {
      env: {},
      error: { code: 'CREDENTIALS_ERROR', message: 'Failed to resolve widget credentials' },
      status: 'failed',
    };
  }

  try {
    const result = await deps.runner.run({
      env,
      network: { allow: manifest?.network?.allow ?? [] },
      runtime: version.runtime,
      script: version.script,
      subject: { id: widget.id, kind: 'widget' },
      timeoutMs: manifest?.timeoutMs,
    });

    const stdout = redactSecrets(result.stdout, env);
    const stderr = redactSecrets(result.stderr, env);
    const base = { durationMs: result.durationMs, env, exitCode: result.exitCode, stderr, stdout };

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
    // `meta.complete === false`: shown on the card, kept out of the trend.
    return {
      ...base,
      error: null,
      output: parsed.output,
      status: parsed.partial ? 'partial' : 'succeeded',
    };
  } catch (error) {
    const code = error instanceof WidgetSandboxError ? error.code : 'SANDBOX_ERROR';
    const message = error instanceof Error ? error.message : String(error);
    return { env, error: { code, message: redactSecrets(message, env) }, status: 'failed' };
  }
};

/**
 * Execute one opened run end to end and close it:
 *
 * 1. resolve the declared env from the widget's connector scope — a missing
 *    required variable fails the run with `MISSING_ENV`, a connector the
 *    script's author may not read with `CREDENTIALS_FORBIDDEN`, both before
 *    any sandbox call;
 * 2. execute the version's script on the sandbox with the manifest's network
 *    allowlist;
 * 3. redact injected secrets (and well-known token shapes) from stdout / stderr
 *    before anything is parsed or persisted, then truncate the streams;
 * 4. judge the result — timeout → `timeout`; non-zero exit → `NON_ZERO_EXIT`;
 *    stdout not matching the contract → the contract's error code; a valid
 *    output with `meta.complete === false` → `partial`;
 * 5. finish the run. `WidgetModel.finishRun` folds a current, non-preview run
 *    into the widget snapshot (`succeeded` / `partial` replace `latestOutput`);
 * 6. a `succeeded` non-preview run appends its numbers to the widget's metric
 *    trend; `partial` runs never do.
 *
 * Never throws for script or sandbox failures — they become the run's status.
 */
export const executeWidgetRun = async (
  db: LobeChatDatabase,
  params: ExecuteWidgetRunParams,
  deps: ExecuteWidgetRunDeps,
): Promise<WidgetRunRow | undefined> => {
  const { run, version, widget } = params;
  const outcome = await runInSandbox(db, params, deps);

  const finishedAt = new Date();
  const finished = await WidgetModel.finishRun(db, run.id, {
    durationMs: outcome.durationMs ?? null,
    error: outcome.error ?? null,
    exitCode: outcome.exitCode ?? null,
    finishedAt,
    output: outcome.output ?? null,
    status: outcome.status,
    stderr: outcome.stderr ? sanitizeStream(outcome.stderr, outcome.env) : null,
    stdout: outcome.stdout ? sanitizeStream(outcome.stdout, outcome.env) : null,
  });

  if (finished && run.trigger !== 'preview' && outcome.status === 'succeeded' && outcome.output) {
    try {
      const { primaryMetricId } = await recordWidgetMetrics(db, widget, {
        manifest: version.manifest,
        observedAt: finishedAt,
        output: outcome.output,
        runId: run.id,
      });
      if (primaryMetricId && primaryMetricId !== widget.metricId) {
        await WidgetModel.linkMetric(db, widget.id, primaryMetricId);
      }
    } catch (error) {
      // The run itself succeeded; a trend write failure must not flip it.
      console.error('[widget:executeRun] failed to record metrics widget=%s', widget.id, error);
    }
  }

  log('run=%s widget=%s status=%s', run.id, widget.id, outcome.status);
  return finished;
};
