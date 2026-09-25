import { CronExpressionParser } from 'cron-parser';

export interface IsExecutionTimeInput {
  /**
   * When the schedule was (re)armed. An occurrence before it is never fired:
   * arming after a slot has passed waits for the next one, even when the task
   * has never run or its last run is older than the arming.
   */
  armedAt?: Date | null;
  /** Cron pattern in standard 5-field form: `minute hour day month weekday`. */
  cronPattern: string;
  /** Defaults to `Date.now()` when omitted — exposed for tests. */
  currentTime?: Date;
  /**
   * How long after a scheduled occurrence a dispatcher tick may still fire it.
   * Covers a late or skipped tick of the central dispatcher; an occurrence
   * older than this is skipped rather than replayed.
   */
  graceMinutes?: number;
  /** Last successful execution; an occurrence at or before it is already covered. */
  lastExecutedAt?: Date | null;
  /** IANA timezone (e.g. `Asia/Shanghai`); defaults to `UTC` when null/empty. */
  timezone: string | null;
}

/**
 * Cadence of the central schedule dispatcher (`lobe-task-schedule-dispatch`,
 * `*\/10 * * * *` in `scripts/serverLauncher/startServer.js`).
 */
export const SCHEDULE_DISPATCH_INTERVAL_MINUTES = 10;

/**
 * An occurrence can be up to one interval old on the tick that should fire it;
 * tolerate one more missed tick plus delivery jitter. Anything older is skipped
 * rather than replayed, so a stale slot never fires long after the fact.
 */
export const DEFAULT_SCHEDULE_GRACE_MINUTES = SCHEDULE_DISPATCH_INTERVAL_MINUTES * 2 + 5;

const CRON_FIELD_COUNT = 5;
const MINUTE_MS = 60 * 1000;

export const isValidTimezone = (tz: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

const parseCron = (cronPattern: string, timezone: string | null, currentDate: Date) => {
  const pattern = cronPattern.trim();
  // Only the standard 5-field form is accepted: 6-field (seconds) and `@daily`
  // style aliases are rejected so every stored pattern means the same thing to
  // the dispatcher, the task UI and the agent that wrote it.
  if (pattern.split(/\s+/).length !== CRON_FIELD_COUNT) {
    throw new Error(
      `expected 5 fields "minute hour day-of-month month day-of-week", got "${cronPattern}"`,
    );
  }
  const tz = timezone || 'UTC';
  if (!isValidTimezone(tz)) throw new Error(`unknown timezone "${tz}"`);

  return CronExpressionParser.parse(pattern, { currentDate, tz });
};

/**
 * Decide whether a cron pattern is due on this dispatcher tick.
 *
 * The central dispatcher polls on a fixed cadence (every 10 minutes), so the
 * question is not "does `now` match the pattern" but "is there a scheduled
 * occurrence that has passed and has not run yet". The matcher:
 *
 * - Finds `prev`, the latest occurrence at or before `now` within the grace
 *   window, in the pattern's timezone with full cron semantics (day-of-month,
 *   month, ranges, steps, lists, names).
 * - Fires only when such an occurrence exists, so a task never fires
 *   ahead of its occurrence.
 * - Fires only when `prev` is at or after `armedAt`, so arming a task after
 *   today's slot has passed waits for the next slot instead of replaying the
 *   missed one.
 * - Fires only when `lastExecutedAt < prev`, so each occurrence runs at most
 *   once no matter how many ticks fall inside the grace window. A manual run
 *   before the occurrence does not consume it.
 *
 * Invalid patterns or timezones never fire; use `validateCronPattern` on the
 * write path to reject them up front.
 */
export const isExecutionTime = (input: IsExecutionTimeInput): boolean => {
  const {
    armedAt,
    cronPattern,
    timezone,
    lastExecutedAt,
    currentTime = new Date(),
    graceMinutes = DEFAULT_SCHEDULE_GRACE_MINUTES,
  } = input;

  let expression: ReturnType<typeof parseCron>;
  try {
    expression = parseCron(cronPattern, timezone, currentTime);
  } catch {
    return false;
  }

  // Walk the grace window backwards minute by minute instead of calling
  // `prev()`: the dispatcher evaluates every scheduled task on each tick, and
  // `prev()` on a sparse pattern (e.g. a yearly date) scans a whole year.
  const nowMinute = Math.floor(currentTime.getTime() / MINUTE_MS) * MINUTE_MS;
  let prev: number | undefined;
  for (let offset = 0; offset <= graceMinutes; offset += 1) {
    const candidate = nowMinute - offset * MINUTE_MS;
    if (expression.includesDate(new Date(candidate))) {
      prev = candidate;
      break;
    }
  }

  if (prev === undefined) return false;
  if (armedAt && new Date(armedAt).getTime() > prev) return false;
  if (lastExecutedAt && new Date(lastExecutedAt).getTime() >= prev) return false;

  return true;
};

export type CronValidationResult =
  { error: string; valid: false } | { nextRuns: Date[]; valid: true };

/**
 * Validate a cron pattern for the task scheduler and preview its next runs.
 *
 * Rejects anything the dispatcher cannot evaluate (wrong field count, out of
 * range values, unknown timezone) and patterns that never occur (e.g.
 * `0 0 30 2 *`), so callers can refuse the write instead of storing a
 * schedule that silently misfires.
 */
export const validateCronPattern = (
  cronPattern: string,
  timezone: string | null,
  options: { count?: number; from?: Date } = {},
): CronValidationResult => {
  const { count = 3, from = new Date() } = options;
  try {
    const expression = parseCron(cronPattern, timezone, from);
    const nextRuns = expression.take(count).map((date) => new Date(date.getTime()));
    if (nextRuns.length === 0) return { error: 'the pattern never occurs', valid: false };
    return { nextRuns, valid: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error), valid: false };
  }
};

/** "next runs (Asia/Shanghai) → Mon 2026-09-28 09:00; …" so the agent can check the schedule it set. */
export const formatScheduleNextRuns = (runs: Date[], timezone: string | null): string => {
  const tz = timezone || 'UTC';
  const format = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    month: '2-digit',
    timeZone: tz,
    weekday: 'short',
    year: 'numeric',
  });
  const label = (date: Date) => {
    const parts = Object.fromEntries(format.formatToParts(date).map((p) => [p.type, p.value]));
    return `${parts.weekday} ${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
  };
  return `next runs (${tz}) → ${runs.map(label).join('; ')}`;
};

export type SchedulePreviewResult =
  { error: string; valid: false } | { preview: string; valid: true };

/**
 * Validate the schedule a task will end up with and describe its next runs,
 * shared by every runtime of the `setTaskSchedule` tool so they all return the
 * same confirmation (or refusal) to the agent.
 */
export const previewSchedule = (
  cronPattern: string,
  timezone: string | null,
  options: { count?: number; from?: Date } = {},
): SchedulePreviewResult => {
  const result = validateCronPattern(cronPattern, timezone, options);
  if (!result.valid) return result;
  return { preview: formatScheduleNextRuns(result.nextRuns, timezone), valid: true };
};

/** The refusal both runtimes return when `setTaskSchedule` is given an unusable schedule. */
export const formatInvalidScheduleMessage = (identifier: string, error: string): string =>
  `Invalid schedule for task ${identifier}: ${error}. Use a standard 5-field cron expression "minute hour day-of-month month day-of-week" (e.g. "0 9 * * 1-5") with an IANA timezone. Nothing was updated.`;
