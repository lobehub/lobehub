import type { Dayjs } from 'dayjs';

export type ScheduleType = 'daily' | 'hourly' | 'weekly';

/** Schedule UI only exposes :00 / :30 — minutes are normalized to one of these. */
const SCHEDULE_MINUTE_STEP = 30;
/** Cron weekday list when no specific weekdays are selected (Sun..Sat). */
const ALL_WEEKDAYS = '0,1,2,3,4,5,6';

const normalizeMinuteToHalfHour = (raw: number): 0 | 30 =>
  raw >= SCHEDULE_MINUTE_STEP / 2 && raw < SCHEDULE_MINUTE_STEP + SCHEDULE_MINUTE_STEP / 2 ? 30 : 0;

export interface ParsedSchedule {
  hourlyInterval?: number;
  scheduleType: ScheduleType;
  triggerHour: number;
  triggerMinute: number;
  weekdays?: number[];
}

/**
 * i18n key suffixes for cron weekday numbers (0=Sunday, 1=Monday, ..., 6=Saturday).
 * Combine with `setting:agentCronJobs.weekday.${WEEKDAY_I18N_KEYS[n]}`.
 */
export const WEEKDAY_I18N_KEYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

export type WeekdayI18nKey = (typeof WEEKDAY_I18N_KEYS)[number];

/** Format `HH:mm` from numeric hour/minute, zero-padded. */
export const formatScheduleTime = (hour: number, minute: number): string =>
  `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

/**
 * Parse cron pattern to extract schedule info.
 * Format: minute hour day month weekday
 *
 * Falls back to `{ scheduleType: 'daily', triggerHour: 0, triggerMinute: 0 }`
 * for malformed or unsupported patterns — matches the legacy behavior used by
 * the cron-edit form.
 */
export const parseCronPattern = (cronPattern: string): ParsedSchedule => {
  const parts = cronPattern.trim().split(/\s+/);
  if (parts.length !== 5) {
    return { scheduleType: 'daily', triggerHour: 0, triggerMinute: 0 };
  }

  const [minute, hour, , , weekday] = parts;
  const rawMinute = minute === '*' ? 0 : Number.parseInt(minute, 10);
  const triggerMinute = normalizeMinuteToHalfHour(rawMinute);

  // Hourly: 0 * * * * or 0 */N * * *
  if (hour.startsWith('*/')) {
    const interval = Number.parseInt(hour.slice(2), 10);
    return {
      hourlyInterval: interval,
      scheduleType: 'hourly',
      triggerHour: 0,
      triggerMinute,
    };
  }
  if (hour === '*') {
    return {
      hourlyInterval: 1,
      scheduleType: 'hourly',
      triggerHour: 0,
      triggerMinute,
    };
  }

  const triggerHour = Number.parseInt(hour, 10);

  // Weekly: has specific weekday(s)
  if (weekday !== '*') {
    const weekdays = weekday.split(',').map((d) => Number.parseInt(d, 10));
    return {
      scheduleType: 'weekly',
      triggerHour,
      triggerMinute,
      weekdays,
    };
  }

  // Daily: specific hour, any weekday
  return {
    scheduleType: 'daily',
    triggerHour,
    triggerMinute,
  };
};

/**
 * Build cron pattern from schedule info.
 * Format: minute hour day month weekday
 */
export const buildCronPattern = (
  scheduleType: ScheduleType,
  triggerTime: Dayjs,
  hourlyInterval?: number,
  weekdays?: number[],
): string => {
  const minute = normalizeMinuteToHalfHour(triggerTime.minute());
  const hour = triggerTime.hour();

  switch (scheduleType) {
    case 'hourly': {
      const interval = hourlyInterval || 1;
      if (interval === 1) {
        return `${minute} * * * *`;
      }
      return `${minute} */${interval} * * *`;
    }
    case 'daily': {
      return `${minute} ${hour} * * *`;
    }
    case 'weekly': {
      const days =
        weekdays && weekdays.length > 0
          ? [...weekdays].sort((a, b) => a - b).join(',')
          : ALL_WEEKDAYS;
      return `${minute} ${hour} * * ${days}`;
    }
  }
};
