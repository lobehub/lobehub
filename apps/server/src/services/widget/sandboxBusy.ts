import type { WidgetRow, WidgetRunRow } from '@/database/schemas';

import { isWidgetSandboxBusy } from './sandbox/types';
import { nextScheduleOccurrence } from './schedule';

/**
 * What a run does when the sandbox answers `SANDBOX_BUSY` (the account is at
 * its concurrency or rate limit):
 *
 * - someone is waiting on the request (`manual`, `preview`): retry in process,
 *   honouring the hint, a few times and well inside the request budget, then
 *   fail with `SANDBOX_BUSY`;
 * - a `schedule` run: leave the reservation `running`, so the scheduler's
 *   stale-lease recovery picks it up again once its lease expires (a couple of
 *   minutes), until {@link busyDeferralDeadline} — then close it as failed.
 */

/** Attempts a waiting caller's run makes in total, the first included. */
export const WIDGET_BUSY_MAX_ATTEMPTS = 3;
/** Total time a waiting caller's run may spend waiting for a slot. */
export const WIDGET_BUSY_RETRY_BUDGET_MS = 30_000;
/** Used when the sandbox gave no hint. */
export const WIDGET_BUSY_DEFAULT_RETRY_AFTER_MS = 5000;
/** Spread so two runs turned away together do not collide again. */
const WIDGET_BUSY_RETRY_JITTER_MS = 500;
/** How long a scheduled run keeps waiting for a slot after it was reserved. */
export const WIDGET_BUSY_DEFER_DEADLINE_MS = 30 * 60 * 1000;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Run `attempt`, retrying while it throws `SANDBOX_BUSY` — at most
 * {@link WIDGET_BUSY_MAX_ATTEMPTS} attempts and
 * {@link WIDGET_BUSY_RETRY_BUDGET_MS} of waiting in total. A wait that would
 * overrun the budget is not started: the busy error is rethrown at once.
 */
export const runWithBusyRetry = async <T>(attempt: () => Promise<T>): Promise<T> => {
  let waited = 0;
  for (let attempts = 1; ; attempts += 1) {
    try {
      return await attempt();
    } catch (error) {
      if (!isWidgetSandboxBusy(error) || attempts >= WIDGET_BUSY_MAX_ATTEMPTS) throw error;
      const wait =
        (error.retryAfterMs ?? WIDGET_BUSY_DEFAULT_RETRY_AFTER_MS) +
        Math.floor(Math.random() * WIDGET_BUSY_RETRY_JITTER_MS);
      if (waited + wait > WIDGET_BUSY_RETRY_BUDGET_MS) throw error;
      await sleep(wait);
      waited += wait;
    }
  }
};

/**
 * Until when a busy scheduled run may stay deferred: 30 minutes after it was
 * reserved, or the widget's next slot after that, whichever comes first — the
 * next slot reserves a fresh run, and two runs of one widget waiting for the
 * same account's slots only make the queue longer. Without a reservation time
 * (not a reserved run) there is nothing to defer.
 */
export const busyDeferralDeadline = (
  run: Partial<Pick<WidgetRunRow, 'createdAt'>>,
  widget: Partial<Pick<WidgetRow, 'schedulePattern' | 'scheduleTimezone'>>,
): Date | undefined => {
  if (!run.createdAt) return undefined;
  const byAge = new Date(run.createdAt.getTime() + WIDGET_BUSY_DEFER_DEADLINE_MS);
  const nextSlot = widget.schedulePattern
    ? nextScheduleOccurrence(widget.schedulePattern, widget.scheduleTimezone, run.createdAt)
    : null;
  return nextSlot && nextSlot < byAge ? nextSlot : byAge;
};
