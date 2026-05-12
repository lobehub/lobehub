import dayjs, { type Dayjs } from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import type { TFunction } from 'i18next';

import { parseCronPattern, type ScheduleType, WEEKDAYS } from './CronConfig';

dayjs.extend(utc);
dayjs.extend(timezone);

const padTime = (n: number) => String(n).padStart(2, '0');

const formatHHmm = (hour: number, minute: number) => `${padTime(hour)}:${padTime(minute)}`;

/**
 * Pretty interval like "10 min" / "2 hr" / "30 sec".
 * Reuses the same `taskSchedule.unit.*` plural keys as TaskTriggerTag.
 */
export const formatIntervalLabel = (seconds: number, t: TFunction<'chat'>): string => {
  if (seconds <= 0) return '';
  if (seconds % 3600 === 0) return t('taskSchedule.unit.hour', { count: seconds / 3600 });
  if (seconds % 60 === 0) return t('taskSchedule.unit.minute', { count: seconds / 60 });
  return t('taskSchedule.unit.second', { count: seconds });
};

/**
 * Localized timezone display name (e.g. "中国标准时间", "Pacific Daylight Time").
 * Falls back to the IANA id when the runtime can't resolve a long name.
 */
export const formatTimezoneName = (tz: string, locale: string): string => {
  try {
    const parts = new Intl.DateTimeFormat(locale, {
      timeZone: tz,
      timeZoneName: 'long',
    }).formatToParts(new Date());
    return parts.find((p) => p.type === 'timeZoneName')?.value ?? tz;
  } catch {
    return tz;
  }
};

/**
 * Human description of a cron pattern like "每天 09:00" or "Every 2 hours :30".
 */
export const formatScheduleDescription = (pattern: string, t: TFunction<'chat'>): string => {
  const parsed = parseCronPattern(pattern);
  switch (parsed.scheduleType) {
    case 'hourly': {
      const interval = parsed.hourlyInterval ?? 1;
      // Cron storage rounds minutes to 0 or 30 (see buildCronPattern). Reading
      // ':30' literally felt awkward in the summary, so call it out as
      // "half past" only when it's actually non-zero and stay implicit on :00.
      const isHalfPast = parsed.triggerMinute === 30;
      if (interval === 1) {
        return isHalfPast
          ? t('taskSchedule.summary.hourlyHalfPast')
          : t('taskSchedule.summary.hourly');
      }
      return isHalfPast
        ? t('taskSchedule.summary.everyNHoursHalfPast', { count: interval })
        : t('taskSchedule.summary.everyNHours', { count: interval });
    }
    case 'daily': {
      return t('taskSchedule.summary.daily', {
        time: formatHHmm(parsed.triggerHour, parsed.triggerMinute),
      });
    }
    case 'weekly': {
      const days = parsed.weekdays ?? [];
      const allDays = days.length === 7;
      if (allDays) {
        return t('taskSchedule.summary.daily', {
          time: formatHHmm(parsed.triggerHour, parsed.triggerMinute),
        });
      }
      const labels = [...days]
        .sort((a, b) => a - b)
        .map((d) => t(WEEKDAYS.find((w) => w.key === d)!.label as any))
        .join('/');
      return t('taskSchedule.summary.weekly', {
        days: labels,
        time: formatHHmm(parsed.triggerHour, parsed.triggerMinute),
      });
    }
  }
};

/**
 * Compute the next firing time for a parsed cron schedule, in the given timezone.
 * Returns a Dayjs in `tz` so callers can format relative to user locale.
 */
const computeNextScheduleFiring = (
  scheduleType: ScheduleType,
  triggerHour: number,
  triggerMinute: number,
  hourlyInterval: number | undefined,
  weekdays: number[] | undefined,
  tz: string,
): Dayjs => {
  const now = dayjs().tz(tz);

  switch (scheduleType) {
    case 'hourly': {
      const interval = hourlyInterval && hourlyInterval > 0 ? hourlyInterval : 1;
      let candidate = now.minute(triggerMinute).second(0).millisecond(0);
      if (!candidate.isAfter(now)) candidate = candidate.add(1, 'hour');
      while (candidate.hour() % interval !== 0) {
        candidate = candidate.add(1, 'hour');
      }
      return candidate;
    }
    case 'daily': {
      let candidate = now.hour(triggerHour).minute(triggerMinute).second(0).millisecond(0);
      if (!candidate.isAfter(now)) candidate = candidate.add(1, 'day');
      return candidate;
    }
    case 'weekly': {
      const days = weekdays && weekdays.length > 0 ? weekdays : [0, 1, 2, 3, 4, 5, 6];
      for (let offset = 0; offset < 8; offset += 1) {
        const candidate = now
          .add(offset, 'day')
          .hour(triggerHour)
          .minute(triggerMinute)
          .second(0)
          .millisecond(0);
        if (days.includes(candidate.day()) && candidate.isAfter(now)) return candidate;
      }
      return now.add(1, 'week');
    }
  }
};

/**
 * Next firing time for a cron pattern in IANA timezone. Returns null if pattern is
 * unparseable.
 */
export const nextScheduleFiring = (pattern: string, tz: string | null): Dayjs | null => {
  const parsed = parseCronPattern(pattern);
  const safeTz = tz || dayjs.tz.guess();
  try {
    return computeNextScheduleFiring(
      parsed.scheduleType,
      parsed.triggerHour,
      parsed.triggerMinute,
      parsed.hourlyInterval,
      parsed.weekdays,
      safeTz,
    );
  } catch {
    return null;
  }
};

/**
 * Next heartbeat firing time strictly after now. Catches up by interval steps
 * when `lastAt` is stale (e.g. task was paused for hours).
 */
export const nextHeartbeatFiring = (
  lastAt: string | null | undefined,
  intervalSeconds: number,
): Dayjs | null => {
  if (!intervalSeconds || intervalSeconds <= 0) return null;
  const now = dayjs();
  if (!lastAt) return now.add(intervalSeconds, 'second');
  const base = dayjs(lastAt);
  const next = base.add(intervalSeconds, 'second');
  if (next.isAfter(now)) return next;
  const intervalMs = intervalSeconds * 1000;
  const steps = Math.floor(now.diff(base) / intervalMs) + 1;
  return base.add(steps * intervalSeconds, 'second');
};
