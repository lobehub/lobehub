import {
  DEVICE_OFFLINE_RUN_STATUS,
  QUOTA_LIMITED_RUN_STATUS,
  TRANSIENT_FAILED_RUN_STATUS,
} from '@lobechat/const/goal';
import type { TaskContext, TaskRecentRun } from '@lobechat/types';
import { TASK_AUTOMATION_FAILURE_FUSE } from '@lobechat/types';
import { DEFAULT_SCHEDULE_GRACE_MINUTES, validateCronPattern } from '@lobechat/utils/cronEval';

/**
 * What a recurring task is doing, in the terms its owner acts on. The task's
 * `status` alone does not say whether its schedule still fires: a `scheduled`
 * heartbeat whose fuse blew is no longer re-armed, a `running` task is skipped
 * by every tick until its run ends, and an unanswered urgent brief holds any
 * tick back.
 *
 * - `stopped`: the failure fuse blew; nothing fires until the task runs clean.
 * - `awaitingHuman`: an urgent brief is unanswered; ticks are skipped.
 * - `awaitingReview`: the task is paused for review; a schedule skips it.
 * - `overrun`: a run is still going past the point the next one was due.
 * - `running`: a run is in flight.
 * - `scheduled`: waiting for `nextRunAt`.
 */
export type ScheduleHealth =
  'awaitingHuman' | 'awaitingReview' | 'overrun' | 'running' | 'scheduled' | 'stopped';

/** The table's sections, in display order. */
export const SCHEDULE_GROUP_KEYS = ['attention', 'running', 'scheduled'] as const;
export type ScheduleGroupKey = (typeof SCHEDULE_GROUP_KEYS)[number];

const GROUP_BY_HEALTH: Record<ScheduleHealth, ScheduleGroupKey> = {
  awaitingHuman: 'attention',
  awaitingReview: 'attention',
  overrun: 'attention',
  running: 'running',
  scheduled: 'scheduled',
  stopped: 'attention',
};

/** The fields of a list row the schedule state is read from. */
export interface ScheduleTaskInput {
  automationMode?: 'heartbeat' | 'schedule' | null;
  awaitingHuman?: boolean;
  context?: unknown;
  heartbeatInterval?: number | null;
  id: string;
  lastHeartbeatAt?: Date | string | null;
  recentRuns?: TaskRecentRun[];
  schedulePattern?: string | null;
  scheduleTimezone?: string | null;
  startedAt?: Date | string | null;
  status: string;
}

export interface ScheduleState {
  /** Automation ticks that failed in a row since the last clean one. */
  consecutiveFailures: number;
  group: ScheduleGroupKey;
  health: ScheduleHealth;
  /** When the task fires next; null whenever it will not fire on its own. */
  nextRunAt: Date | null;
  /** Start of the run in flight; null unless the task is running. */
  runningSince: Date | null;
}

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

/**
 * A heartbeat has no slot to miss, so a run counts as overrun once it has
 * lasted two of its own intervals, and never before two hours: a short
 * interval with a long but healthy run must not be called out.
 */
const HEARTBEAT_OVERRUN_FLOOR_MS = 2 * HOUR_MS;

const toDate = (value: Date | string | null | undefined): Date | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/** Next occurrence of a cron pattern strictly after `from`; null when it cannot be evaluated. */
const nextCronOccurrence = (pattern: string, timezone: string | null, from: Date): Date | null => {
  const result = validateCronPattern(pattern, timezone, { count: 1, from });
  return result.valid ? result.nextRuns[0] : null;
};

const nextHeartbeat = (base: Date | null, intervalSeconds: number, now: Date): Date => {
  const intervalMs = intervalSeconds * 1000;
  if (!base) return new Date(now.getTime() + intervalMs);
  const next = base.getTime() + intervalMs;
  if (next > now.getTime()) return new Date(next);
  // The pending tick is late (or the base is stale): step to the next slot after now.
  const steps = Math.floor((now.getTime() - base.getTime()) / intervalMs) + 1;
  return new Date(base.getTime() + steps * intervalMs);
};

const resolveNextRunAt = (task: ScheduleTaskInput, now: Date): Date | null => {
  if (task.automationMode === 'schedule') {
    if (!task.schedulePattern) return null;
    return nextCronOccurrence(task.schedulePattern, task.scheduleTimezone ?? null, now);
  }
  if (task.automationMode === 'heartbeat') {
    const interval = task.heartbeatInterval ?? 0;
    if (interval <= 0) return null;
    const context = task.context as TaskContext | null | undefined;
    // The pending tick's enqueue time when known, else the last tick.
    const base = toDate(context?.scheduler?.scheduledAt) ?? toDate(task.lastHeartbeatAt);
    return nextHeartbeat(base, interval, now);
  }
  return null;
};

const resolveRunningSince = (task: ScheduleTaskInput): Date | null => {
  const running = task.recentRuns?.find((run) => run.status === 'running');
  return toDate(running?.createdAt) ?? toDate(task.startedAt);
};

const isOverrun = (task: ScheduleTaskInput, since: Date, now: Date): boolean => {
  if (task.automationMode === 'schedule') {
    if (!task.schedulePattern) return false;
    // The dispatcher skips a running task, so the occurrence after the run
    // began is lost once its grace window has closed.
    const due = nextCronOccurrence(task.schedulePattern, task.scheduleTimezone ?? null, since);
    return !!due && due.getTime() + DEFAULT_SCHEDULE_GRACE_MINUTES * MINUTE_MS < now.getTime();
  }
  const intervalMs = (task.heartbeatInterval ?? 0) * 1000;
  if (intervalMs <= 0) return false;
  return now.getTime() - since.getTime() > Math.max(2 * intervalMs, HEARTBEAT_OVERRUN_FLOOR_MS);
};

export const resolveScheduleState = (task: ScheduleTaskInput, now: Date): ScheduleState => {
  const context = task.context as TaskContext | null | undefined;
  const consecutiveFailures = context?.scheduler?.consecutiveFailures ?? 0;
  const state = (
    health: ScheduleHealth,
    extra: Partial<Pick<ScheduleState, 'nextRunAt' | 'runningSince'>> = {},
  ): ScheduleState => ({
    consecutiveFailures,
    group: GROUP_BY_HEALTH[health],
    health,
    nextRunAt: null,
    runningSince: null,
    ...extra,
  });

  if (task.status === 'running') {
    const runningSince = resolveRunningSince(task);
    const overrun = !!runningSince && isOverrun(task, runningSince, now);
    return state(overrun ? 'overrun' : 'running', { runningSince });
  }
  if (consecutiveFailures >= TASK_AUTOMATION_FAILURE_FUSE) return state('stopped');
  // The brief is the more specific ask: answering it is what unblocks the task.
  if (task.awaitingHuman) return state('awaitingHuman');
  if (task.status === 'paused') return state('awaitingReview');
  return state('scheduled', { nextRunAt: resolveNextRunAt(task, now) });
};

export interface ScheduleRow<T extends ScheduleTaskInput> {
  state: ScheduleState;
  task: T;
}

export interface ScheduleGroup<T extends ScheduleTaskInput> {
  key: ScheduleGroupKey;
  rows: ScheduleRow<T>[];
}

/** Stopped first: it will never recover alone; an overrun may still finish. */
const ATTENTION_ORDER: ScheduleHealth[] = ['stopped', 'awaitingHuman', 'awaitingReview', 'overrun'];

/** Earlier first; a missing time sorts last, and two missing times tie. */
const compareTimes = (a: Date | null, b: Date | null): number => {
  if (!a || !b) return Number(!a) - Number(!b);
  return a.getTime() - b.getTime();
};

const compareRows = <T extends ScheduleTaskInput>(a: ScheduleRow<T>, b: ScheduleRow<T>): number => {
  if (a.state.group === 'attention') {
    return ATTENTION_ORDER.indexOf(a.state.health) - ATTENTION_ORDER.indexOf(b.state.health);
  }
  // Longest-running first: the closest to becoming an overrun.
  if (a.state.group === 'running') return compareTimes(a.state.runningSince, b.state.runningSince);
  // Soonest first; a schedule that cannot be evaluated sinks to the end.
  return compareTimes(a.state.nextRunAt, b.state.nextRunAt);
};

/**
 * Sections of the scheduled tasks table: what needs the user, what is running,
 * then what is waiting, soonest first. Empty sections are left out, and rows
 * that tie keep the order they came in.
 */
export const groupScheduleRows = <T extends ScheduleTaskInput>(
  tasks: readonly T[],
  now: Date,
): ScheduleGroup<T>[] => {
  const rows = tasks.map((task) => ({ state: resolveScheduleState(task, now), task }));
  return SCHEDULE_GROUP_KEYS.map((key) => ({
    key,
    rows: rows.filter((row) => row.state.group === key).sort(compareRows),
  })).filter((group) => group.rows.length > 0);
};

/** How a past run reads at a glance. */
export type RunOutcome = 'canceled' | 'failed' | 'interrupted' | 'running' | 'succeeded';

const RUN_OUTCOME_BY_STATUS: Record<string, RunOutcome> = {
  canceled: 'canceled',
  completed: 'succeeded',
  // The run could not proceed for a reason outside the task: an offline
  // device, an exhausted quota, a transient upstream error.
  [DEVICE_OFFLINE_RUN_STATUS]: 'interrupted',
  failed: 'failed',
  [QUOTA_LIMITED_RUN_STATUS]: 'interrupted',
  running: 'running',
  timeout: 'failed',
  [TRANSIENT_FAILED_RUN_STATUS]: 'interrupted',
};

/** An unknown status reads as interrupted rather than as a success or a failure. */
export const resolveRunOutcome = (status: string): RunOutcome =>
  RUN_OUTCOME_BY_STATUS[status] ?? 'interrupted';
