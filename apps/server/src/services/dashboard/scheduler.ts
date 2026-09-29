import type { DashboardWidgetRunStatus } from '@lobechat/types';
import debug from 'debug';
import pMap from 'p-map';

import { DashboardWidgetModel } from '@/database/models/dashboardWidget';
import type { DashboardWidgetRow, DashboardWidgetVersionRow } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { executeWidgetRun, type ExecuteWidgetRunDeps } from './executeRun';
import { nextScheduleOccurrence } from './schedule';

const log = debug('lobe-server:dashboard:scheduler');

const DEFAULT_TICK_LIMIT = 50;
const DEFAULT_INLINE_CONCURRENCY = 4;
const DEFAULT_DISPATCH_CONCURRENCY = 10;

export interface DashboardTickOptions {
  /**
   * Hand a claimed widget to another worker (QStash in queue mode) instead of
   * running it inline. Rejections are logged; the slot is not replayed.
   */
  dispatch?: (widgetId: string) => Promise<void>;
  /** Report what is due without claiming or running anything. */
  dryRun?: boolean;
  limit?: number;
  now?: Date;
}

export interface DashboardTickResult {
  claimed: number;
  dispatched: number;
  due: number;
  results: { error?: string; status?: DashboardWidgetRunStatus; widgetId: string }[];
}

/**
 * Run one widget's published version as a `schedule` run. Used inline by the
 * tick and by the queued per-widget handler.
 */
export const runScheduledWidget = async (
  db: LobeChatDatabase,
  target: { version: DashboardWidgetVersionRow; widget: DashboardWidgetRow },
  deps: ExecuteWidgetRunDeps,
) => {
  const run = await DashboardWidgetModel.startRun(db, target.widget, {
    trigger: 'schedule',
    versionId: target.version.id,
  });
  return executeWidgetRun(db, { run, version: target.version, widget: target.widget }, deps);
};

/**
 * One scheduler tick: find live, published widgets whose `next_run_at` has
 * passed, claim each slot by moving `next_run_at` to the next cron occurrence
 * (compare-and-set, so overlapping ticks never double-fire), then run the
 * claimed widgets — inline with bounded concurrency, or via `dispatch`.
 *
 * A missed stretch (server down for hours) fires once and resumes at the next
 * future occurrence rather than replaying every skipped slot. An invalid
 * stored pattern clears `next_run_at`, parking the widget until it is fixed.
 */
export const runDashboardSchedulerTick = async (
  db: LobeChatDatabase,
  deps: ExecuteWidgetRunDeps,
  options: DashboardTickOptions = {},
): Promise<DashboardTickResult> => {
  const now = options.now ?? new Date();
  const due = await DashboardWidgetModel.findDue(db, {
    limit: options.limit ?? DEFAULT_TICK_LIMIT,
    now,
  });

  if (options.dryRun || due.length === 0) {
    return { claimed: 0, dispatched: 0, due: due.length, results: [] };
  }

  const claimed: typeof due = [];
  for (const target of due) {
    const { widget } = target;
    const next = nextScheduleOccurrence(widget.schedulePattern!, widget.scheduleTimezone, now);
    const won = await DashboardWidgetModel.claimDue(db, {
      expectedNextRunAt: widget.nextRunAt!,
      nextRunAt: next,
      widgetId: widget.id,
    });
    if (won) claimed.push(target);
    else log('skip widget=%s reason=claimed-elsewhere', widget.id);
  }

  let dispatched = 0;

  if (options.dispatch) {
    const dispatch = options.dispatch;
    const results = await pMap(
      claimed,
      async ({ widget }): Promise<DashboardTickResult['results'][number]> => {
        try {
          await dispatch(widget.id);
          dispatched += 1;
          return { widgetId: widget.id };
        } catch (error) {
          console.error('[dashboard:tick] dispatch failed widget=%s', widget.id, error);
          return { error: String(error), widgetId: widget.id };
        }
      },
      { concurrency: DEFAULT_DISPATCH_CONCURRENCY },
    );
    return { claimed: claimed.length, dispatched, due: due.length, results };
  }

  const results = await pMap(
    claimed,
    async (target): Promise<DashboardTickResult['results'][number]> => {
      try {
        const run = await runScheduledWidget(db, target, deps);
        dispatched += 1;
        return { status: run?.status, widgetId: target.widget.id };
      } catch (error) {
        console.error('[dashboard:tick] run failed widget=%s', target.widget.id, error);
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
