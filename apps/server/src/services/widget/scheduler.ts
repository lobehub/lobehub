import type { WidgetRunStatus } from '@lobechat/types';
import debug from 'debug';
import pMap from 'p-map';

import { WidgetModel } from '@/database/models/widget';
import type { WidgetRow, WidgetVersionRow } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { executeWidgetRun, type ExecuteWidgetRunDeps } from './executeRun';
import { nextScheduleOccurrence } from './schedule';

const log = debug('lobe-server:widget:scheduler');

const DEFAULT_TICK_LIMIT = 50;
const DEFAULT_INLINE_CONCURRENCY = 4;
const DEFAULT_DISPATCH_CONCURRENCY = 10;

/** One due slot handed to another worker: the widget and the `next_run_at` it was due at. */
export interface WidgetDispatchTarget {
  slot: Date;
  widgetId: string;
}

export interface WidgetTickOptions {
  /**
   * Hand a due slot to another worker (QStash in queue mode) instead of
   * running it inline. The tick does not claim dispatched slots — the worker
   * does (see `runDispatchedWidget`), so a redelivered message cannot run the
   * widget twice. A rejected dispatch leaves the slot due for the next tick.
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
  results: { error?: string; status?: WidgetRunStatus; widgetId: string }[];
}

/**
 * Run one widget's published version as a `schedule` run. Used inline by the
 * tick and by the queued per-widget handler.
 */
export const runScheduledWidget = async (
  db: LobeChatDatabase,
  target: { version: WidgetVersionRow; widget: WidgetRow },
  deps: ExecuteWidgetRunDeps,
) => {
  const run = await WidgetModel.startRun(db, target.widget, {
    trigger: 'schedule',
    versionId: target.version.id,
  });
  return executeWidgetRun(db, { run, version: target.version, widget: target.widget }, deps);
};

/**
 * Claim one slot by moving `next_run_at` from `slot` to the next cron
 * occurrence (compare-and-set). Exactly one caller wins per slot.
 */
const claimSlot = (
  db: LobeChatDatabase,
  widget: Pick<WidgetRow, 'id' | 'schedulePattern' | 'scheduleTimezone'>,
  slot: Date,
  now: Date,
) =>
  WidgetModel.claimDue(db, {
    expectedNextRunAt: slot,
    nextRunAt: nextScheduleOccurrence(widget.schedulePattern!, widget.scheduleTimezone, now),
    widgetId: widget.id,
  });

export type DispatchedWidgetResult =
  | { run: Awaited<ReturnType<typeof runScheduledWidget>>; skipped?: undefined }
  | { skipped: 'already-claimed' | 'not-runnable' };

/**
 * Consumer half of a queued scheduled run. Claims the dispatched slot and
 * runs the widget only when the claim wins, so a redelivered (or duplicated)
 * message for the same slot is a no-op.
 */
export const runDispatchedWidget = async (
  db: LobeChatDatabase,
  target: WidgetDispatchTarget,
  deps: ExecuteWidgetRunDeps,
  options: { now?: Date } = {},
): Promise<DispatchedWidgetResult> => {
  const live = await WidgetModel.findLiveWithPublishedVersion(db, target.widgetId);
  // Trashed, unpublished or unscheduled since the tick: nothing to run.
  if (!live?.widget.schedulePattern) return { skipped: 'not-runnable' };

  const won = await claimSlot(db, live.widget, target.slot, options.now ?? new Date());
  if (!won) {
    log('skip widget=%s slot=%s reason=already-claimed', target.widgetId, target.slot);
    return { skipped: 'already-claimed' };
  }

  return { run: await runScheduledWidget(db, live, deps) };
};

/**
 * One scheduler tick: find live, published widgets whose `next_run_at` has
 * passed. With `dispatch` (queue mode) each due slot is handed to a worker,
 * which claims it before running. Inline, the tick claims each slot itself
 * by moving `next_run_at` to the next cron occurrence (compare-and-set, so
 * overlapping ticks never double-fire), then runs the claimed widgets with
 * bounded concurrency.
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
  const due = await WidgetModel.findDue(db, {
    limit: options.limit ?? DEFAULT_TICK_LIMIT,
    now,
  });

  if (options.dryRun || due.length === 0) {
    return { claimed: 0, dispatched: 0, due: due.length, results: [] };
  }

  let dispatched = 0;

  if (options.dispatch) {
    const dispatch = options.dispatch;
    const results = await pMap(
      due,
      async ({ widget }): Promise<WidgetTickResult['results'][number]> => {
        try {
          await dispatch({ slot: widget.nextRunAt!, widgetId: widget.id });
          dispatched += 1;
          return { widgetId: widget.id };
        } catch (error) {
          console.error('[widget:tick] dispatch failed widget=%s', widget.id, error);
          return { error: String(error), widgetId: widget.id };
        }
      },
      { concurrency: DEFAULT_DISPATCH_CONCURRENCY },
    );
    return { claimed: 0, dispatched, due: due.length, results };
  }

  const claimed: typeof due = [];
  for (const target of due) {
    const { widget } = target;
    if (await claimSlot(db, widget, widget.nextRunAt!, now)) claimed.push(target);
    else log('skip widget=%s reason=claimed-elsewhere', widget.id);
  }

  const results = await pMap(
    claimed,
    async (target): Promise<WidgetTickResult['results'][number]> => {
      try {
        const run = await runScheduledWidget(db, target, deps);
        dispatched += 1;
        return { status: run?.status, widgetId: target.widget.id };
      } catch (error) {
        console.error('[widget:tick] run failed widget=%s', target.widget.id, error);
        return {
          error: error instanceof Error ? error.message : String(error),
          widgetId: target.widget.id,
        };
      }
    },
    { concurrency: DEFAULT_INLINE_CONCURRENCY },
  );

  return { claimed: claimed.length, dispatched, due: due.length, results };
};
