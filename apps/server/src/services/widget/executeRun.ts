import type { WidgetOutput, WidgetRunError, WidgetRunFinalStatus } from '@lobechat/types';
import debug from 'debug';

import { WidgetModel } from '@/database/models/widget';
import type { WidgetRow, WidgetRunRow, WidgetVersionRow } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { GoalSubscriptionService } from '../goal/subscriptions';
import {
  ForbiddenWidgetCredentialsError,
  MissingWidgetEnvError,
  type ResolvedWidgetEnv,
  resolveWidgetEnv,
  type ResolveWidgetEnvOptions,
  type WidgetCredentialScope,
} from './credentials';
import { recordWidgetMetrics } from './metrics';
import { parseWidgetOutput } from './outputContract';
import { redactSecrets, sanitizeStream } from './redact';
import { isWidgetSandboxBusy, WidgetSandboxError, type WidgetSandboxRunner } from './sandbox/types';
import { busyDeferralDeadline, runWithBusyRetry } from './sandboxBusy';

const log = debug('lobe-server:widget:execute-run');

/** How much of stderr a NON_ZERO_EXIT error message quotes. */
const ERROR_STDERR_TAIL = 500;

export type ResolveWidgetEnv = (
  db: LobeChatDatabase,
  scope: WidgetCredentialScope,
  requirements: NonNullable<WidgetVersionRow['manifest']>['env'],
  options: Pick<ResolveWidgetEnvOptions, 'networkAllow'>,
) => Promise<ResolvedWidgetEnv>;

export interface ExecuteWidgetRunDeps {
  resolveEnv?: ResolveWidgetEnv;
  runner: WidgetSandboxRunner;
}

/**
 * A failure inside the run's metric publication. Only this is answered by
 * recording the run as failed: any other `finishRun` failure is the worker
 * dying mid-completion, and the run must stay `running` so its lease expires
 * and recovery resumes it.
 */
class MetricPublicationError extends Error {}

export interface ExecuteWidgetRunParams {
  /** `createdAt` is when a scheduled run was reserved; it bounds a busy deferral. */
  run: Pick<WidgetRunRow, 'id' | 'trigger'> &
    Partial<Pick<WidgetRunRow, 'createdAt' | 'startedAt'>>;
  version: Pick<
    WidgetVersionRow,
    'manifest' | 'outputType' | 'publishedByUserId' | 'runtime' | 'script' | 'userId'
  >;
  widget: Pick<
    WidgetRow,
    'agentId' | 'id' | 'metricId' | 'projectId' | 'title' | 'userId' | 'workspaceId'
  > &
    Partial<Pick<WidgetRow, 'schedulePattern' | 'scheduleTimezone'>>;
}

/**
 * What became of an executed run. `deferred`: a scheduled run the sandbox was
 * too busy to take; its reservation stays `running` and is resumed once its
 * lease expires. Otherwise `run` is the closed run, or undefined when this
 * worker no longer held it (another worker took it over or closed it).
 */
export type ExecutedWidgetRun =
  { deferred: true; run: undefined } | { deferred?: undefined; run: WidgetRunRow | undefined };

interface RunOutcome {
  /** The sandbox turned the run away for the account's limits (`SANDBOX_BUSY`). */
  busy?: boolean;
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
  { run, version, widget }: ExecuteWidgetRunParams,
  deps: ExecuteWidgetRunDeps,
): Promise<RunOutcome> => {
  const manifest = version.manifest ?? undefined;
  const resolveEnv = deps.resolveEnv ?? resolveWidgetEnv;
  const allow = manifest?.network?.allow ?? [];

  let env: Record<string, string>;
  let inject: ResolvedWidgetEnv['inject'];
  try {
    // Secrets go to whoever wrote the script: the publisher of a live
    // version, the author of a draft.
    const authorUserId = version.publishedByUserId ?? version.userId;
    ({ env, inject } = await resolveEnv(
      db,
      {
        agentId: widget.agentId,
        authorUserId,
        projectId: widget.projectId,
        userId: widget.userId,
        workspaceId: widget.workspaceId,
      },
      manifest?.env,
      { networkAllow: allow },
    ));
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

  const execute = () =>
    deps.runner.run({
      // The widget's owner (or its workspace) pays for and is rate limited on the run.
      actor: { userId: widget.userId, workspaceId: widget.workspaceId },
      env,
      network: { allow, ...(inject.length > 0 ? { inject } : {}) },
      runtime: version.runtime,
      script: version.script,
      subject: { id: widget.id, kind: 'widget' },
      timeoutMs: manifest?.timeoutMs,
    });

  try {
    // Someone waits on a manual or preview run, so a busy sandbox is waited
    // out here; a scheduled run is deferred by the caller instead.
    const result = await (run.trigger === 'schedule' ? execute() : runWithBusyRetry(execute));

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
    const busy = isWidgetSandboxBusy(error);
    return {
      ...(busy && { busy }),
      env,
      error: {
        code,
        message: redactSecrets(
          busy
            ? `The sandbox is busy with other widget runs of this account; try again shortly (${message})`
            : message,
          env,
        ),
      },
      status: 'failed',
    };
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
 *    allowlist, plus the credential headers the egress proxy adds for LobeHub
 *    Market connectors (whose env variables only hold placeholders). When the
 *    account is at its sandbox limits (`SANDBOX_BUSY`), a manual or preview
 *    run retries in process (bounded); a scheduled run is deferred — see
 *    {@link executeWidgetRunDetailed};
 * 3. redact injected secrets (and well-known token shapes) from stdout / stderr
 *    before anything is parsed or persisted, then truncate the streams;
 * 4. judge the result — timeout → `timeout`; non-zero exit → `NON_ZERO_EXIT`;
 *    stdout not matching the contract → the contract's error code; a valid
 *    output with `meta.complete === false` → `partial`;
 * 5. finish the run. `WidgetModel.finishRun` folds a current, non-preview run
 *    into the widget snapshot (`succeeded` / `partial` replace `latestOutput`);
 * 6. a `succeeded` run that folded into the snapshot appends its numbers to
 *    the widget's metric trend; previews, stale runs and `partial` runs never
 *    do.
 *
 * Never throws for script or sandbox failures — they become the run's status.
 */
export const executeWidgetRun = async (
  db: LobeChatDatabase,
  params: ExecuteWidgetRunParams,
  deps: ExecuteWidgetRunDeps,
): Promise<WidgetRunRow | undefined> => (await executeWidgetRunDetailed(db, params, deps)).run;

/**
 * {@link executeWidgetRun}, also reporting a deferral: a `schedule` run the
 * sandbox answered `SANDBOX_BUSY` is not closed while it is before its
 * {@link busyDeferralDeadline}. Its reservation stays `running` with the lease
 * it has, so the scheduler resumes it like an abandoned run once that lease
 * expires — inline from the tick, or through a resume message in queue mode —
 * under the same compare-and-set takeover, so it never runs twice at once.
 * Past the deadline it closes as `failed` with `SANDBOX_BUSY`.
 */
export const executeWidgetRunDetailed = async (
  db: LobeChatDatabase,
  params: ExecuteWidgetRunParams,
  deps: ExecuteWidgetRunDeps,
): Promise<ExecutedWidgetRun> => {
  const { run, version, widget } = params;
  const outcome = await runInSandbox(db, params, deps);

  if (outcome.busy && run.trigger === 'schedule') {
    const deadline = busyDeferralDeadline(run, widget);
    if (deadline && Date.now() < deadline.getTime()) {
      log('defer run=%s widget=%s reason=sandbox-busy until=%s', run.id, widget.id, deadline);
      return { deferred: true, run: undefined };
    }
    log('give up run=%s widget=%s reason=sandbox-busy-past-deadline', run.id, widget.id);
  }

  const finishedAt = new Date();
  let finished: Awaited<ReturnType<typeof WidgetModel.finishRun>>;
  try {
    finished = await WidgetModel.finishRun(
      db,
      run.id,
      {
        expectedStartedAt: run.startedAt,
        durationMs: outcome.durationMs ?? null,
        error: outcome.error ?? null,
        exitCode: outcome.exitCode ?? null,
        finishedAt,
        output: outcome.output ?? null,
        status: outcome.status,
        stderr: outcome.stderr ? sanitizeStream(outcome.stderr, outcome.env) : null,
        stdout: outcome.stdout ? sanitizeStream(outcome.stdout, outcome.env) : null,
      },
      async (tx) => {
        if (!outcome.output) return;
        const transactionalDB = tx as unknown as LobeChatDatabase;
        try {
          const { primaryMetricId } = await recordWidgetMetrics(transactionalDB, widget, {
            manifest: version.manifest,
            observedAt: finishedAt,
            output: outcome.output,
            runId: run.id,
          });
          if (primaryMetricId)
            await WidgetModel.linkMetric(transactionalDB, widget.id, primaryMetricId, run.id);
        } catch (cause) {
          throw new MetricPublicationError('Widget metric publication failed', { cause });
        }
      },
    );
  } catch (error) {
    if (!(error instanceof MetricPublicationError)) throw error;
    console.error('[widget:executeRun] atomic metric publication failed', error);
    // The failed transaction left no points or success. Persist the collection
    // failure in existing history; consumers can handle it without guessing.
    finished = await WidgetModel.finishRun(db, run.id, {
      status: 'failed',
      finishedAt,
      expectedStartedAt: run.startedAt,
      error: {
        code: 'METRIC_PUBLICATION_FAILED',
        message: 'Widget metric publication failed; check source semantics and storage',
      },
    });
  }

  if (finished && finished.run.trigger !== 'preview') {
    // A completion is only a hint. The durable scanner also runs on wait/sweep.
    await GoalSubscriptionService.forWidget(db, widget.id).catch((error) => {
      console.error('[widget:executeRun] subscription scan failed', error);
    });
  }

  log('run=%s widget=%s status=%s', run.id, widget.id, outcome.status);
  return { run: finished?.run };
};
