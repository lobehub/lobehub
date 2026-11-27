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
export const buildMonthGrid = (month: Dayjs, weekStartsOn: 0 | 1): MonthGrid => {
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

/** Monday-first everywhere except the locales that start the week on Sunday. */
export const resolveWeekStart = (locale: string): 0 | 1 =>
  /^(en-US|en-CA|ja|ko|pt-BR|zh-TW|he|ar)/i.test(locale) ? 0 : 1;

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
export const expandPlannedRuns = (task: TaskListItem, range: CalendarRange, now: Date): Date[] => {
  const state = resolveScheduleState(task, now);
  if (HELD_HEALTH.has(state.health)) return [];
  const start = Math.max(now.getTime(), range.from.getTime());
  if (start >= range.to.getTime()) return [];

  if (task.automationMode === 'schedule' && task.schedulePattern) {
    const result = validateCronPattern(task.schedulePattern, task.scheduleTimezone ?? null, {
      count: MAX_PLANNED_PER_TASK,
      // cron-parser steps strictly after `from`; back off a millisecond so a
      // slot exactly at the grid start is kept.
      from: new Date(start - 1),
    });
    if (!result.valid) return [];
    return result.nextRuns.filter((at) => at.getTime() > now.getTime() && at < range.to);
  }

  if (task.automationMode === 'heartbeat' && task.heartbeatInterval) {
    const intervalMs = task.heartbeatInterval * 1000;
    // A running heartbeat has no pending tick yet; its next one follows the run.
    let at = state.nextRunAt?.getTime() ?? now.getTime() + intervalMs;
    // Jump straight to the grid when the next tick lies before it.
    if (at < start) at += Math.ceil((start - at) / intervalMs) * intervalMs;
    const runs: Date[] = [];
    while (at < range.to.getTime() && runs.length < MAX_PLANNED_PER_TASK) {
      runs.push(new Date(at));
      at += intervalMs;
    }
    return runs;
  }

  return [];
};

/** A recurring task's past runs (from `rangeRuns`) and its planned ones. */
export const collectScheduledEntries = (
  tasks: readonly TaskListItem[],
  range: CalendarRange,
  now: Date,
): TaskCalendarEntry[] => {
  const entries: TaskCalendarEntry[] = [];
  for (const task of tasks) {
    for (const run of task.rangeRuns ?? []) {
      const at = toDate(run.createdAt);
      if (!at || at < range.from || at >= range.to) continue;
      entries.push({ at, kind: 'run', outcome: toCalendarRunOutcome(run.status), run, task });
    }
    for (const at of expandPlannedRuns(task, range, now)) {
      entries.push({ at, kind: 'planned', task });
    }
  }
  return entries;
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

/** The viewer's IANA timezone with its current UTC offset, e.g. `Asia/Shanghai (UTC+08:00)`. */
export const formatViewerTimezone = (now: Date = new Date()): string => {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  return `${zone} (UTC${dayjs(now).format('Z')})`;
};
