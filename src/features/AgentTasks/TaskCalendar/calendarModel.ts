import type { TaskCalendarRun } from '@lobechat/types';
import { validateCronPattern } from '@lobechat/utils/cronEval';
import dayjs, { type Dayjs } from 'dayjs';

import type { TaskListItem } from '@/store/task/slices/list/initialState';

import { resolveRunOutcome, resolveScheduleState } from '../ScheduledTaskTable/scheduleState';

/**
 * What a calendar card shows for a past run. `skipped` covers the runs that
 * ended without doing the work: canceled, or interrupted by an offline device,
 * an exhausted quota or a transient upstream error.
 */
export type CalendarRunOutcome = 'failed' | 'running' | 'skipped' | 'succeeded';

export const toCalendarRunOutcome = (status: string): CalendarRunOutcome => {
  const outcome = resolveRunOutcome(status);
  if (outcome === 'canceled' || outcome === 'interrupted') return 'skipped';
  return outcome;
};

export type TaskCalendarEntry =
  | { at: Date; kind: 'run'; outcome: CalendarRunOutcome; run: TaskCalendarRun; task: TaskListItem }
  | { at: Date; kind: 'planned'; task: TaskListItem }
  | { at: Date; kind: 'completed'; task: TaskListItem };

export interface CalendarRange {
  /** Inclusive start of the grid's first day. */
  from: Date;
  /** Exclusive end: the day after the grid's last day. */
  to: Date;
}

export interface MonthGrid extends CalendarRange {
  /** Whole weeks, each seven local days starting on `weekStartsOn`. */
  weeks: Dayjs[][];
}

/**
 * The weeks a month view lays out: from the week holding the 1st to the week
 * holding the last day, in the viewer's local time.
 */
/** First weekday of a grid row: Sunday, Monday or Saturday. */
export type WeekStart = 0 | 1 | 6;

export const buildMonthGrid = (month: Dayjs, weekStartsOn: WeekStart): MonthGrid => {
  const first = month.startOf('month');
  const lead = (first.day() - weekStartsOn + 7) % 7;
  const start = first.subtract(lead, 'day');
  const last = first.endOf('month').startOf('day');
  const days = last.diff(start, 'day') + 1;
  const weekCount = Math.ceil(days / 7);

  const weeks = Array.from({ length: weekCount }, (_, week) =>
    Array.from({ length: 7 }, (_, day) => start.add(week * 7 + day, 'day')),
  );
  return {
    from: start.toDate(),
    to: start.add(weekCount * 7, 'day').toDate(),
    weeks,
  };
};

/** Locales whose week starts on Saturday or Sunday; every other one starts on Monday. */
const SATURDAY_FIRST = /^(ar|fa)(-|$)/i;
const SUNDAY_FIRST = /^(en-US|en-CA|ja|ko|pt-BR|zh-TW|he)(-|$)/i;

/**
 * The first weekday of the viewer's locale: the runtime's `weekInfo` when it
 * has one, else a table of the supported locales that differ from Monday.
 */
export const resolveWeekStart = (locale: string): WeekStart => {
  try {
    const info = (
      new Intl.Locale(locale) as Intl.Locale & { getWeekInfo?: () => { firstDay: number } }
    ).getWeekInfo?.();
    // `firstDay` is 1 (Monday) … 7 (Sunday).
    if (info?.firstDay === 6) return 6;
    if (info?.firstDay === 7) return 0;
    if (info?.firstDay === 1) return 1;
  } catch {
    // An unknown locale tag falls through to the table.
  }
  if (SATURDAY_FIRST.test(locale)) return 6;
  return SUNDAY_FIRST.test(locale) ? 0 : 1;
};

export const dayKey = (date: Date | Dayjs): string => dayjs(date).format('YYYY-MM-DD');

/**
 * Upper bound of planned occurrences expanded per task: an hourly schedule
 * across a six-week grid. A denser cadence keeps its earliest slots; the cell
 * already folds anything past its first few entries.
 */
export const MAX_PLANNED_PER_TASK = 24 * 42;

const toDate = (value: Date | string | null | undefined): Date | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/** Health states in which a schedule does not fire on its own. */
const HELD_HEALTH = new Set(['awaitingHuman', 'awaitingReview', 'stopped']);

/**
 * Future occurrences of a recurring task inside `range`, after `now`. A task
 * whose schedule is held (fuse blown, paused for review, waiting on an
 * answer) plans nothing. A run in flight only holds back the ticks it
 * overlaps, which the calendar cannot know, so its later slots still show.
 */
export interface PlannedRuns {
  runs: Date[];
  /** The per-task cap stopped the expansion before the end of the grid. */
  truncated: boolean;
}

const NO_PLANNED_RUNS: PlannedRuns = { runs: [], truncated: false };

export const expandPlannedRuns = (
  task: TaskListItem,
  range: CalendarRange,
  now: Date,
): PlannedRuns => {
  const state = resolveScheduleState(task, now);
  if (HELD_HEALTH.has(state.health)) return NO_PLANNED_RUNS;
  const start = Math.max(now.getTime(), range.from.getTime());
  if (start >= range.to.getTime()) return NO_PLANNED_RUNS;

  if (task.automationMode === 'schedule' && task.schedulePattern) {
    const result = validateCronPattern(task.schedulePattern, task.scheduleTimezone ?? null, {
      count: MAX_PLANNED_PER_TASK,
      // cron-parser steps strictly after `from`; back off a millisecond so a
      // slot exactly at the grid start is kept.
      from: new Date(start - 1),
    });
    if (!result.valid) return NO_PLANNED_RUNS;
    const last = result.nextRuns.at(-1);
    return {
      runs: result.nextRuns.filter((at) => at.getTime() > now.getTime() && at < range.to),
      // A full batch that still ends inside the grid left its tail unexpanded.
      truncated: result.nextRuns.length >= MAX_PLANNED_PER_TASK && !!last && last < range.to,
    };
  }

  // A heartbeat re-arms an interval after each run finishes, so only its
  // pending tick is known; a running one has none until the run ends.
  if (task.automationMode === 'heartbeat') {
    const at = state.nextRunAt;
    return at && at.getTime() >= start && at < range.to
      ? { runs: [at], truncated: false }
      : NO_PLANNED_RUNS;
  }

  return NO_PLANNED_RUNS;
};

/**
 * Recurring tasks' past runs (from `rangeRuns`) and planned ones; `truncated`
 * when a dense cadence could not be expanded across the whole grid.
 */
export const collectScheduledEntries = (
  tasks: readonly TaskListItem[],
  range: CalendarRange,
  now: Date,
): { entries: TaskCalendarEntry[]; truncated: boolean } => {
  const entries: TaskCalendarEntry[] = [];
  let truncated = false;
  for (const task of tasks) {
    for (const run of task.rangeRuns ?? []) {
      const at = toDate(run.createdAt);
      if (!at || at < range.from || at >= range.to) continue;
      entries.push({ at, kind: 'run', outcome: toCalendarRunOutcome(run.status), run, task });
    }
    const planned = expandPlannedRuns(task, range, now);
    if (planned.truncated) truncated = true;
    for (const at of planned.runs) entries.push({ at, kind: 'planned', task });
  }
  return { entries, truncated };
};

/**
 * Ordinary tasks placed on the day they were completed. Tasks carry no due or
 * planned date, so a task that is not completed has no day and is left out.
 */
export const collectCompletedEntries = (
  tasks: readonly TaskListItem[],
  range: CalendarRange,
): TaskCalendarEntry[] =>
  tasks.flatMap((task): TaskCalendarEntry[] => {
    if (task.status !== 'completed') return [];
    const at = toDate(task.completedAt);
    if (!at || at < range.from || at >= range.to) return [];
    return [{ at, kind: 'completed', task }];
  });

/** Entries by local day, each day in time order. */
export const groupEntriesByDay = (
  entries: readonly TaskCalendarEntry[],
): Map<string, TaskCalendarEntry[]> => {
  const byDay = new Map<string, TaskCalendarEntry[]>();
  for (const entry of entries) {
    const key = dayKey(entry.at);
    const day = byDay.get(key) ?? [];
    day.push(entry);
    byDay.set(key, day);
  }
  for (const day of byDay.values()) day.sort((a, b) => a.at.getTime() - b.at.getTime());
  return byDay;
};

/**
 * The viewer's IANA timezone with the UTC offset its card times use across the
 * displayed grid, e.g. `Asia/Shanghai (UTC+08:00)`. A grid that crosses a
 * daylight-saving change names both offsets: `America/New_York (UTC-04:00 / -05:00)`.
 */
export const formatViewerTimezone = (range: CalendarRange): string => {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const first = dayjs(range.from).format('Z');
  // The last instant inside the grid, not the exclusive end.
  const last = dayjs(range.to.getTime() - 1).format('Z');
  return first === last ? `${zone} (UTC${first})` : `${zone} (UTC${first} / ${last})`;
};
