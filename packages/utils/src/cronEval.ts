import { CronExpressionParser } from 'cron-parser';

export interface IsExecutionTimeInput {
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

/** The central dispatcher ticks every 5 minutes; tolerate two missed ticks plus jitter. */
export const DEFAULT_SCHEDULE_GRACE_MINUTES = 15;

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
 * The central dispatcher polls on a fixed cadence (every 5 minutes), so the
 * question is not "does `now` match the pattern" but "is there a scheduled
 * occurrence that has passed and has not run yet". The matcher:
 *
 * - Finds `prev`, the latest occurrence at or before `now` within the grace
 *   window, in the pattern's timezone with full cron semantics (day-of-month,
 *   month, ranges, steps, lists, names).
 * - Fires only when such an occurrence exists, so a task never fires
 *   ahead of its occurrence, and arming a task after today's slot has passed
 *   waits for the next slot instead of replaying the missed one.
 * - Fires only when `lastExecutedAt < prev`, so each occurrence runs at most
 *   once no matter how many ticks fall inside the grace window. A manual run
 *   before the occurrence does not consume it.
 *
 * Invalid patterns or timezones never fire; use `validateCronPattern` on the
 * write path to reject them up front.
 */
export const isExecutionTime = (input: IsExecutionTimeInput): boolean => {
  const {
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
