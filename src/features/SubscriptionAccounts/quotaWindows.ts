import dayjs from 'dayjs';

import type { AccountView, AccountWindowKey } from './accountView';

const HOUR = 60 * 60 * 1000;

/** One coding-agent session window: the unit work is handed out in. */
export const WINDOW_MS = 5 * HOUR;
/** How far ahead the calendar looks. A weekly window resets at most 7 days out. */
export const HORIZON_MS = 7 * 24 * HOUR;

/** A window at or above this share is used up — the load balancer's threshold. */
const EXHAUSTED_PERCENT = 100;
/** A window at or above this share has little left to hand out. */
const TIGHT_PERCENT = 80;

export interface QuotaAxis {
  end: number;
  /** One window before now, so a window under way is drawn whole. */
  start: number;
}

export const buildQuotaAxis = (now: number): QuotaAxis => ({
  end: now + HORIZON_MS,
  start: now - WINDOW_MS,
});

/** A limit that colours a window: which one, how far it is used, and when it resets. */
export interface WindowLimit {
  /** The provider gave no reset time: `until` is the latest it can be. */
  estimated?: boolean;
  key: AccountWindowKey;
  until: number;
  usedPercent: number;
}

export type WindowState =
  /** Nothing spent in it yet. */
  | 'idle'
  /** Partly spent. */
  | 'used'
  /** A used-up limit blocks it. */
  | 'blocked';

export interface QuotaWindow {
  /** The used-up limit behind a `blocked` window. */
  blockedBy?: WindowLimit;
  end: number;
  start: number;
  state: WindowState;
  /** A limit over the tight threshold covers this window. */
  tightBy?: WindowLimit;
  /** Only the window under way has a reading of its own. */
  usedPercent?: number;
}

const liveLimit = (
  view: Pick<AccountView, AccountWindowKey>,
  key: AccountWindowKey,
  now: number,
): WindowLimit | undefined => {
  const window = view[key];
  if (!window) return undefined;
  if (window.resetsAt != null)
    return window.resetsAt > now
      ? { key, until: window.resetsAt, usedPercent: window.usedPercent }
      : undefined;
  // No reported reset: the reading still binds until it ages out, so keep it, marked as a bound.
  if (window.latestResetAt != null && window.latestResetAt > now)
    return { estimated: true, key, until: window.latestResetAt, usedPercent: window.usedPercent };
  return undefined;
};

/**
 * One account's 5-hour windows from the one under way to the end of the axis.
 * Only the current window is known; the ones after it are laid back to back,
 * because a new window starts the moment someone uses the account again. A
 * used-up weekly limit blocks every window that starts before it resets.
 */
export const accountWindows = (
  view: Pick<AccountView, AccountWindowKey>,
  axis: QuotaAxis,
  now: number,
): QuotaWindow[] => {
  const session = liveLimit(view, 'session', now);
  const weekly = liveLimit(view, 'weekly', now);

  const windows: QuotaWindow[] = [];
  // The window under way ends at its reset; with none live, the next one starts now.
  let start = session ? session.until - WINDOW_MS : now;
  for (; start < axis.end; start += WINDOW_MS) {
    const current = !!session && start === session.until - WINDOW_MS;
    const used = current ? session.usedPercent : 0;

    let blockedBy: WindowLimit | undefined;
    if (current && used >= EXHAUSTED_PERCENT) blockedBy = session;
    if (weekly && weekly.usedPercent >= EXHAUSTED_PERCENT && start < weekly.until)
      blockedBy = weekly;

    let tightBy: WindowLimit | undefined;
    if (!blockedBy) {
      if (current && used >= TIGHT_PERCENT) tightBy = session;
      else if (weekly && weekly.usedPercent >= TIGHT_PERCENT && start < weekly.until)
        tightBy = weekly;
    }

    windows.push({
      blockedBy,
      end: start + WINDOW_MS,
      start,
      state: blockedBy ? 'blocked' : used > 0 ? 'used' : 'idle',
      tightBy,
      usedPercent: current ? used : undefined,
    });
  }
  return windows;
};

/** Whether the account can take work at `at`: some window holds it, and it is not blocked. */
export const isUsableAt = (windows: QuotaWindow[], at: number) =>
  windows.some((window) => window.start <= at && at < window.end && window.state !== 'blocked');

/** Fixed 5-hour buckets from now, for counting how many accounts can take work in each. */
export const teamBuckets = (now: number, axis: QuotaAxis) => {
  const buckets: { end: number; start: number }[] = [];
  for (let start = now; start < axis.end; start += WINDOW_MS)
    buckets.push({ end: start + WINDOW_MS, start });
  return buckets;
};

/** Local midnights strictly inside the axis: where one day hands over to the next. */
export const axisMidnights = (axis: QuotaAxis): number[] => {
  const days: number[] = [];
  let day = dayjs(axis.start).startOf('day').add(1, 'day');
  while (day.valueOf() < axis.end) {
    days.push(day.valueOf());
    day = day.add(1, 'day');
  }
  return days;
};

export interface QuotaSummary {
  available: number;
  exhausted: number;
  /** Soonest a used-up account gets capacity back. */
  nextRecoveryAt?: number;
  /** Soonest reset of any window on an account in rotation. */
  nextResetAt?: number;
}

/** The header line: how many accounts can take work now, and when the next one frees up. */
export const summarizeQuota = (views: AccountView[], now: number): QuotaSummary => {
  const soonest = (values: (number | null | undefined)[]) => {
    const ahead = values.filter((value): value is number => value != null && value > now);
    return ahead.length ? Math.min(...ahead) : undefined;
  };
  const inRotation = views.filter((view) => view.status !== 'disabled');
  const exhausted = inRotation.filter((view) => view.status === 'exhausted');

  return {
    available: inRotation.filter((view) => view.status === 'available').length,
    exhausted: exhausted.length,
    nextRecoveryAt: soonest(exhausted.map((view) => view.recoversAt)),
    nextResetAt: soonest(
      inRotation.flatMap((view) => [view.session?.resetsAt, view.weekly?.resetsAt]),
    ),
  };
};

export type ResetDay = 'today' | 'tomorrow' | 'later';

/** Which local day a time falls on, relative to now — how it is worded. */
export const resetDayOf = (at: number, now: number): ResetDay => {
  if (dayjs(at).isSame(now, 'day')) return 'today';
  if (dayjs(at).isSame(dayjs(now).add(1, 'day'), 'day')) return 'tomorrow';
  return 'later';
};
