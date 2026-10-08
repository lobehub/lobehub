import type { WidgetManifest, WidgetRunStatus } from '@lobechat/types';
import debug from 'debug';
import pMap from 'p-map';

import { WidgetModel } from '@/database/models/widget';
import type { WidgetRow, WidgetRunRow, WidgetVersionRow } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { executeWidgetRun, type ExecuteWidgetRunDeps } from './executeRun';
import { clampSandboxTimeout, WIDGET_SANDBOX_REQUEST_OVERHEAD_MS } from './sandbox/types';
import { nextScheduleOccurrence } from './schedule';

const log = debug('lobe-server:widget:scheduler');

const DEFAULT_TICK_LIMIT = 50;
const DEFAULT_INLINE_CONCURRENCY = 4;
const DEFAULT_DISPATCH_CONCURRENCY = 10;

/** Slack on top of the sandbox bounds before a reserved run counts as abandoned. */
export const WIDGET_RUN_LEASE_MARGIN_MS = 60_000;
/** Reservations older than this are no longer resumed — that occurrence is long gone. */
const RESUME_HORIZON_MS = 24 * 60 * 60 * 1000;

/**
 * How long a worker may hold a reserved scheduled run before another worker
 * may take it over: the version's (clamped) script timeout, plus what the
 * sandbox request may add on top, plus a margin for credential resolution
 * and closing the run.
 */
export const widgetRunLeaseMs = (manifest?: Pick<WidgetManifest, 'timeoutMs'> | null) =>
  clampSandboxTimeout(manifest?.timeoutMs) +
  WIDGET_SANDBOX_REQUEST_OVERHEAD_MS +
  WIDGET_RUN_LEASE_MARGIN_MS;

/** The shortest lease any version can have — the coarse cut for the stale query. */
const MIN_LEASE_MS = widgetRunLeaseMs({ timeoutMs: 1 });

/** One due slot handed to another worker: the widget and the `next_run_at` it was due at. */
export interface WidgetSlotTarget {
  slot: Date;
  widgetId: string;
}

/**
 * One abandoned reservation handed to another worker to resume. The lease it
 * was judged stale under travels along so a re-dispatch after a further
 * crash is a distinct message.
 */
export interface WidgetResumeTarget {
  leaseStartedAt: Date;
  runId: string;
  widgetId: string;
}

export type WidgetDispatchTarget = WidgetResumeTarget | WidgetSlotTarget;

export const isWidgetResumeTarget = (target: WidgetDispatchTarget): target is WidgetResumeTarget =>
  'runId' in target;

export interface WidgetTickOptions {
  /**
   * Hand work to another worker (QStash in queue mode) instead of running it
   * inline: due slots, which the worker claims (see `runDispatchedWidget`),
   * and stale reservations, which it resumes (see `resumeDispatchedRun`). A
   * rejected dispatch leaves the slot due / the run stale for the next tick.
   */
  dispatch?: (target: WidgetDispatchTarget) => Promise<void>;
  /** Report what is due without claiming or running anything. */
  dryRun?: boolean;
  limit?: number;
  now?: Date;
}

export interface WidgetTickResult {
  /** Slots this tick claimed itself — inline mode only; dispatched slots are claimed by the worker. */
  claimed: number;
  dispatched: number;
  due: number;
  results: { error?: string; runId?: string; status?: WidgetRunStatus; widgetId: string }[];
  /** Stale reservations taken over (inline) or handed to a worker to resume (queue mode). */
  resumed: number;
}

interface RunTarget {
  run: WidgetRunRow;
  version: WidgetVersionRow;
  widget: WidgetRow;
}

const nextOccurrence = (
  widget: Pick<WidgetRow, 'schedulePattern' | 'scheduleTimezone'>,
  now: Date,
) => nextScheduleOccurrence(widget.schedulePattern!, widget.scheduleTimezone, now);

/**
 * Reserved scheduled runs whose lease has expired — the worker that reserved
 * (or last resumed) them is presumed dead. The query cuts at the shortest
 * possible lease; each run's own lease (from its version's timeout) decides.
 */
const findStaleRuns = async (
  db: LobeChatDatabase,
  now: Date,
  filter: { limit: number; runId?: string; widgetId?: string },
): Promise<RunTarget[]> => {
  const rows = await WidgetModel.findStaleScheduledRuns(db, {
    ...filter,
    createdAfter: new Date(now.getTime() - RESUME_HORIZON_MS),
    startedBefore: new Date(now.getTime() - MIN_LEASE_MS),
  });
  return rows.filter(
    ({ run, version }) =>
      now.getTime() - run.startedAt.getTime() > widgetRunLeaseMs(version.manifest),
  );
};

/** Take over a stale run (compare-and-set on its lease); undefined when another worker won. */
const takeOver = async (
  db: LobeChatDatabase,
  target: RunTarget,
): Promise<RunTarget | undefined> => {
  const run = await WidgetModel.renewRunLease(db, {
    expectedStartedAt: target.run.startedAt,
    runId: target.run.id,
  });
  if (!run) {
    log('skip run=%s reason=resumed-elsewhere', target.run.id);
    return undefined;
  }
  log('resume run=%s widget=%s', run.id, target.widget.id);
  return { ...target, run };
};

export type DispatchedWidgetResult =
  | {
      /** The run was a stale reservation taken over rather than a fresh claim. */
      resumed?: boolean;
      run: WidgetRunRow | undefined;
      skipped?: undefined;
    }
  | { skipped: 'already-claimed' | 'not-resumable' | 'not-runnable' };

/**
 * Consumer half of a queued scheduled run. Claims the dispatched slot —
 * advancing `next_run_at` and reserving the `schedule` run in one
 * transaction — and executes the reserved run.
 *
 * When the slot is already claimed (a redelivery, or a duplicate message),
 * the reservation it left behind is resumed only if its lease has expired,
 * i.e. the worker that reserved it died before closing it; a run still
 * within its lease is left to its worker and the message is acknowledged.
 */
export const runDispatchedWidget = async (
  db: LobeChatDatabase,
  target: WidgetSlotTarget,
  deps: ExecuteWidgetRunDeps,
  options: { now?: Date } = {},
): Promise<DispatchedWidgetResult> => {
  const now = options.now ?? new Date();
  const live = await WidgetModel.findLiveWithPublishedVersion(db, target.widgetId);
  // Trashed, unpublished or unscheduled since the tick: nothing to run.
  if (!live?.widget.schedulePattern) return { skipped: 'not-runnable' };

  const reserved = await WidgetModel.claimDueRun(db, {
    expectedNextRunAt: target.slot,
    nextRunAt: nextOccurrence(live.widget, now),
    versionId: live.version.id,
    widgetId: live.widget.id,
  });
  if (reserved) {
    return { run: await executeWidgetRun(db, { ...live, run: reserved }, deps) };
  }

  const [stale] = await findStaleRuns(db, now, { limit: 1, widgetId: target.widgetId });
  const resumed = stale && (await takeOver(db, stale));
  if (!resumed) {
    log('skip widget=%s slot=%s reason=already-claimed', target.widgetId, target.slot);
    return { skipped: 'already-claimed' };
  }

  return { resumed: true, run: await executeWidgetRun(db, resumed, deps) };
};

/**
 * Consumer half of a resume dispatched by the tick's stale sweep: take the
 * run over if it is still stale (nobody resumed or closed it meanwhile) and
 * execute it.
 */
export const resumeDispatchedRun = async (
  db: LobeChatDatabase,
  target: Pick<WidgetResumeTarget, 'runId' | 'widgetId'>,
  deps: ExecuteWidgetRunDeps,
  options: { now?: Date } = {},
): Promise<DispatchedWidgetResult> => {
  const [stale] = await findStaleRuns(db, options.now ?? new Date(), {
    limit: 1,
    runId: target.runId,
    widgetId: target.widgetId,
  });
  const resumed = stale && (await takeOver(db, stale));
  if (!resumed) return { skipped: 'not-resumable' };

  return { resumed: true, run: await executeWidgetRun(db, resumed, deps) };
};

/**
 * One scheduler tick.
 *
 * Due slots: live, published widgets whose `next_run_at` has passed. With
 * `dispatch` (queue mode) each slot is handed to a worker, which claims it.
 * Inline, the tick claims each slot itself — advancing `next_run_at` and
 * reserving the run in one transaction (compare-and-set, so overlapping ticks
 * never double-fire) — then executes the reserved runs with bounded
 * concurrency.
 *
 * Stale reservations: scheduled runs left `running` past their lease because
 * their worker died. Each tick resumes a bounded batch — handed to a worker
 * in queue mode (deduplicated per lease), taken over and executed inline
 * otherwise.
 *
 * A missed stretch (server down for hours) fires once and resumes at the next
 * future occurrence rather than replaying every skipped slot. An invalid
 * stored pattern clears `next_run_at`, parking the widget until it is fixed.
 */
export const runWidgetSchedulerTick = async (
  db: LobeChatDatabase,
  deps: ExecuteWidgetRunDeps,
  options: WidgetTickOptions = {},
): Promise<WidgetTickResult> => {
  const now = options.now ?? new Date();
  const limit = options.limit ?? DEFAULT_TICK_LIMIT;
  const due = await WidgetModel.findDue(db, { limit, now });

  if (options.dryRun) {
    return { claimed: 0, dispatched: 0, due: due.length, resumed: 0, results: [] };
  }

  const stale = await findStaleRuns(db, now, { limit });
  let dispatched = 0;
  let resumed = 0;

  if (options.dispatch) {
    const dispatch = options.dispatch;
    const targets: WidgetDispatchTarget[] = [
      ...due.map(({ widget }) => ({ slot: widget.nextRunAt!, widgetId: widget.id })),
      ...stale.map(({ run, widget }) => ({
        leaseStartedAt: run.startedAt,
        runId: run.id,
        widgetId: widget.id,
      })),
    ];
    const results = await pMap(
      targets,
      async (target): Promise<WidgetTickResult['results'][number]> => {
        const runId = isWidgetResumeTarget(target) ? target.runId : undefined;
        try {
          await dispatch(target);
          if (runId) resumed += 1;
          else dispatched += 1;
          return { ...(runId && { runId }), widgetId: target.widgetId };
        } catch (error) {
          console.error('[widget:tick] dispatch failed widget=%s', target.widgetId, error);
          return { error: String(error), ...(runId && { runId }), widgetId: target.widgetId };
        }
      },
      { concurrency: DEFAULT_DISPATCH_CONCURRENCY },
    );
    return { claimed: 0, dispatched, due: due.length, resumed, results };
  }

  const runnable: RunTarget[] = [];
  for (const target of stale) {
    const taken = await takeOver(db, target);
    if (taken) runnable.push(taken);
  }
  resumed = runnable.length;

  let claimed = 0;
  for (const { version, widget } of due) {
    const run = await WidgetModel.claimDueRun(db, {
      expectedNextRunAt: widget.nextRunAt!,
      nextRunAt: nextOccurrence(widget, now),
      versionId: version.id,
      widgetId: widget.id,
    });
    if (!run) {
      log('skip widget=%s reason=claimed-elsewhere', widget.id);
      continue;
    }
    claimed += 1;
    runnable.push({ run, version, widget });
  }

  const results = await pMap(
    runnable,
    async (target): Promise<WidgetTickResult['results'][number]> => {
      try {
        const run = await executeWidgetRun(db, target, deps);
        dispatched += 1;
        return { runId: target.run.id, status: run?.status, widgetId: target.widget.id };
      } catch (error) {
        // The reservation stays `running`; a later tick resumes it once its lease expires.
        console.error('[widget:tick] run failed widget=%s', target.widget.id, error);
        return {
          error: error instanceof Error ? error.message : String(error),
          runId: target.run.id,
          widgetId: target.widget.id,
        };
      }
    },
    { concurrency: DEFAULT_INLINE_CONCURRENCY },
  );

  return { claimed, dispatched, due: due.length, resumed, results };
};
