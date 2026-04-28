import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);
dayjs.extend(timezone);

export interface IsExecutionTimeInput {
  /** Cron pattern in standard 5-field form: `minute hour day month weekday`. */
  cronPattern: string;
  /** Defaults to `Date.now()` when omitted — exposed for tests. */
  currentTime?: Date;
  /** Last successful execution; used to dedup within the same window. */
  lastExecutedAt?: Date | null;
  /** IANA timezone (e.g. `Asia/Shanghai`); defaults to `UTC` when null/empty. */
  timezone: string | null;
  /** Tolerance window in minutes — central dispatchers run on a coarse cadence
   *  (e.g. every 30 min), so an exact-minute match is too brittle. */
  toleranceMinutes?: number;
}

const DAILY_PATTERN_HOUR_REGEX = /^\d+$/;

/**
 * Decide whether a cron pattern is "due now" within a tolerance window.
 *
 * Designed for a central dispatcher polling on a fixed cadence (e.g. QStash
 * Schedule firing every 30 minutes). The matcher:
 *
 * - Converts the dispatcher's UTC `now` to the pattern's local timezone.
 * - Dedups against `lastExecutedAt` so the same pattern doesn't fire twice
 *   within its own interval (e.g. a daily 09:00 job won't refire at 09:15
 *   on the same day in `Asia/Shanghai`).
 * - Catches up missed daily runs: if the dispatcher missed the scheduled hour
 *   (downtime / cold start) and the job hasn't run today yet, a later tick
 *   on the same day still fires it.
 *
 * Supported patterns (matches what `packages/utils/src/cron.ts` produces):
 *
 *   - `*\/N * * * *`  — every N minutes
 *   - `M * * * *`      — every hour at minute M
 *   - `M *\/N * * *`  — every N hours at minute M
 *   - `M H * * *`      — daily at H:M
 *   - `M H * * D[,D]`  — weekly on weekday list at H:M
 *   - `M *,M * * *`    — minute list (e.g. `0,15,30,45`)
 *   - `M H,H * * *`    — hour list
 */
export const isExecutionTime = (input: IsExecutionTimeInput): boolean => {
  const {
    cronPattern,
    timezone: tz,
    lastExecutedAt,
    currentTime = new Date(),
    toleranceMinutes = 5,
  } = input;

  const jobTimezone = tz || 'UTC';
  const localTime = dayjs(currentTime).tz(jobTimezone);
  const minute = localTime.minute();
  const hour = localTime.hour();

  const parts = cronPattern.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [cronMinute, cronHour, , , cronWeekday] = parts;

  // ── Dedup against last execution ────────────────────────────────
  if (lastExecutedAt) {
    const last = new Date(lastExecutedAt);
    const minutesSince = (currentTime.getTime() - last.getTime()) / (1000 * 60);

    if (cronMinute.startsWith('*/')) {
      const minIntervalMin = Number.parseInt(cronMinute.slice(2), 10);
      if (Number.isFinite(minIntervalMin) && minutesSince < minIntervalMin) return false;
    } else if (cronHour.startsWith('*/')) {
      const hourInterval = Number.parseInt(cronHour.slice(2), 10);
      if (Number.isFinite(hourInterval) && minutesSince < hourInterval * 60) return false;
    } else if (cronHour === '*') {
      // Every hour at a specific minute (e.g. `30 * * * *`)
      if (minutesSince < 60) return false;
    } else if (DAILY_PATTERN_HOUR_REGEX.test(cronHour)) {
      // Daily at specific hour — dedup by calendar day in the job's timezone
      const lastLocal = dayjs(last).tz(jobTimezone);
      const nowLocal = dayjs(currentTime).tz(jobTimezone);
      if (
        lastLocal.year() === nowLocal.year() &&
        lastLocal.month() === nowLocal.month() &&
        lastLocal.date() === nowLocal.date()
      ) {
        return false;
      }
    }
  }

  const weekday = localTime.day();

  // ── Daily catch-up: scheduled hour passed today and we haven't run yet ──
  const isDailyPattern =
    DAILY_PATTERN_HOUR_REGEX.test(cronHour) && /^(?:\d+|\*\/\d+)$/.test(cronMinute);

  if (isDailyPattern) {
    const targetHour = Number.parseInt(cronHour, 10);
    let shouldCatchUp: boolean;

    if (lastExecutedAt) {
      const lastLocal = dayjs(lastExecutedAt).tz(jobTimezone);
      const nowLocal = dayjs(currentTime).tz(jobTimezone);
      const lastIsToday =
        lastLocal.year() === nowLocal.year() &&
        lastLocal.month() === nowLocal.month() &&
        lastLocal.date() === nowLocal.date();
      shouldCatchUp = !lastIsToday && hour > targetHour;
    } else {
      shouldCatchUp = hour > targetHour;
    }

    if (shouldCatchUp) {
      if (cronWeekday !== '*') {
        const allowedWeekdays = cronWeekday.split(',').map((d) => Number.parseInt(d.trim(), 10));
        if (!allowedWeekdays.includes(weekday)) return false;
      }
      return true;
    }
  }

  // ── Minute field ────────────────────────────────────────────────
  if (cronMinute !== '*') {
    if (cronMinute.startsWith('*/')) {
      const interval = Number.parseInt(cronMinute.slice(2), 10);
      if (!Number.isFinite(interval) || interval <= 0) return false;
      const lastSlot = Math.floor(minute / interval) * interval;
      if (minute - lastSlot > toleranceMinutes) return false;
    } else if (cronMinute.includes(',')) {
      const allowed = cronMinute.split(',').map((m) => Number.parseInt(m, 10));
      if (!allowed.some((target) => Math.abs(minute - target) <= toleranceMinutes)) return false;
    } else {
      const target = Number.parseInt(cronMinute, 10);
      if (Math.abs(minute - target) > toleranceMinutes) return false;
    }
  }

  // ── Hour field ──────────────────────────────────────────────────
  if (cronHour !== '*') {
    if (cronHour.startsWith('*/')) {
      const interval = Number.parseInt(cronHour.slice(2), 10);
      if (!Number.isFinite(interval) || interval <= 0) return false;
      const lastSlot = Math.floor(hour / interval) * interval;
      if (hour - lastSlot > 0) return false;
    } else if (cronHour.includes(',')) {
      const allowed = cronHour.split(',').map((h) => Number.parseInt(h, 10));
      if (!allowed.includes(hour)) return false;
    } else {
      if (hour !== Number.parseInt(cronHour, 10)) return false;
    }
  }

  // ── Weekday field ───────────────────────────────────────────────
  if (cronWeekday !== '*') {
    const allowed = cronWeekday.split(',').map((d) => Number.parseInt(d.trim(), 10));
    if (!allowed.includes(weekday)) return false;
  }

  return true;
};
