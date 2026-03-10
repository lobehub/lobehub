import { type Dayjs } from 'dayjs';

export type ScheduleType = 'custom' | 'daily' | 'hourly' | 'weekly';

// Schedule type options
export const SCHEDULE_TYPE_OPTIONS = [
  { label: 'agentCronJobs.scheduleType.hourly', value: 'hourly' },
  { label: 'agentCronJobs.scheduleType.daily', value: 'daily' },
  { label: 'agentCronJobs.scheduleType.weekly', value: 'weekly' },
  { label: 'agentCronJobs.scheduleType.custom', value: 'custom' },
] as const;

// Timezone options - covering major cities worldwide
export const TIMEZONE_OPTIONS = [
  { label: 'UTC', value: 'UTC' },

  // Americas
  { label: 'America/New_York (EST/EDT, UTC-5/-4)', value: 'America/New_York' },
  { label: 'America/Chicago (CST/CDT, UTC-6/-5)', value: 'America/Chicago' },
  { label: 'America/Denver (MST/MDT, UTC-7/-6)', value: 'America/Denver' },
  { label: 'America/Los_Angeles (PST/PDT, UTC-8/-7)', value: 'America/Los_Angeles' },
  { label: 'America/Toronto (EST/EDT, UTC-5/-4)', value: 'America/Toronto' },
  { label: 'America/Vancouver (PST/PDT, UTC-8/-7)', value: 'America/Vancouver' },
  { label: 'America/Mexico_City (CST, UTC-6)', value: 'America/Mexico_City' },
  { label: 'America/Sao_Paulo (BRT, UTC-3)', value: 'America/Sao_Paulo' },
  { label: 'America/Buenos_Aires (ART, UTC-3)', value: 'America/Buenos_Aires' },

  // Europe
  { label: 'Europe/London (GMT/BST, UTC+0/+1)', value: 'Europe/London' },
  { label: 'Europe/Paris (CET/CEST, UTC+1/+2)', value: 'Europe/Paris' },
  { label: 'Europe/Berlin (CET/CEST, UTC+1/+2)', value: 'Europe/Berlin' },
  { label: 'Europe/Madrid (CET/CEST, UTC+1/+2)', value: 'Europe/Madrid' },
  { label: 'Europe/Rome (CET/CEST, UTC+1/+2)', value: 'Europe/Rome' },
  { label: 'Europe/Amsterdam (CET/CEST, UTC+1/+2)', value: 'Europe/Amsterdam' },
  { label: 'Europe/Brussels (CET/CEST, UTC+1/+2)', value: 'Europe/Brussels' },
  { label: 'Europe/Moscow (MSK, UTC+3)', value: 'Europe/Moscow' },
  { label: 'Europe/Istanbul (TRT, UTC+3)', value: 'Europe/Istanbul' },

  // Asia
  { label: 'Asia/Dubai (GST, UTC+4)', value: 'Asia/Dubai' },
  { label: 'Asia/Kolkata (IST, UTC+5:30)', value: 'Asia/Kolkata' },
  { label: 'Asia/Shanghai (CST, UTC+8)', value: 'Asia/Shanghai' },
  { label: 'Asia/Hong_Kong (HKT, UTC+8)', value: 'Asia/Hong_Kong' },
  { label: 'Asia/Taipei (CST, UTC+8)', value: 'Asia/Taipei' },
  { label: 'Asia/Singapore (SGT, UTC+8)', value: 'Asia/Singapore' },
  { label: 'Asia/Tokyo (JST, UTC+9)', value: 'Asia/Tokyo' },
  { label: 'Asia/Seoul (KST, UTC+9)', value: 'Asia/Seoul' },
  { label: 'Asia/Bangkok (ICT, UTC+7)', value: 'Asia/Bangkok' },
  { label: 'Asia/Jakarta (WIB, UTC+7)', value: 'Asia/Jakarta' },

  // Oceania
  { label: 'Australia/Sydney (AEDT/AEST, UTC+11/+10)', value: 'Australia/Sydney' },
  { label: 'Australia/Melbourne (AEDT/AEST, UTC+11/+10)', value: 'Australia/Melbourne' },
  { label: 'Australia/Brisbane (AEST, UTC+10)', value: 'Australia/Brisbane' },
  { label: 'Australia/Perth (AWST, UTC+8)', value: 'Australia/Perth' },
  { label: 'Pacific/Auckland (NZDT/NZST, UTC+13/+12)', value: 'Pacific/Auckland' },

  // Africa & Middle East
  { label: 'Africa/Cairo (EET, UTC+2)', value: 'Africa/Cairo' },
  { label: 'Africa/Johannesburg (SAST, UTC+2)', value: 'Africa/Johannesburg' },
];

// Weekday options for checkbox group
export const WEEKDAY_OPTIONS = [
  { label: 'agentCronJobs.weekday.short.monday', value: 1 },
  { label: 'agentCronJobs.weekday.short.tuesday', value: 2 },
  { label: 'agentCronJobs.weekday.short.wednesday', value: 3 },
  { label: 'agentCronJobs.weekday.short.thursday', value: 4 },
  { label: 'agentCronJobs.weekday.short.friday', value: 5 },
  { label: 'agentCronJobs.weekday.short.saturday', value: 6 },
  { label: 'agentCronJobs.weekday.short.sunday', value: 0 },
] as const;

// Weekday labels for display (i18n keys)
export const WEEKDAY_LABELS: Record<number, string> = {
  0: 'agentCronJobs.weekday.sunday',
  1: 'agentCronJobs.weekday.monday',
  2: 'agentCronJobs.weekday.tuesday',
  3: 'agentCronJobs.weekday.wednesday',
  4: 'agentCronJobs.weekday.thursday',
  5: 'agentCronJobs.weekday.friday',
  6: 'agentCronJobs.weekday.saturday',
};

/**
 * Parse cron pattern to extract schedule info for structured UI modes.
 * Unrecognized-but-valid cron expressions will be treated as custom mode.
 * Format: minute hour day month weekday
 */
export const parseCronPattern = (
  cronPattern: string,
): {
  customCronPattern?: string;
  hourlyInterval?: number;
  scheduleType: ScheduleType;
  triggerHour: number;
  triggerMinute: number;
  weekdays?: number[];
} => {
  const parts = cronPattern.trim().split(/\s+/);

  const customResult = {
    customCronPattern: cronPattern,
    scheduleType: 'custom' as const,
    triggerHour: 0,
    triggerMinute: 0,
  };

  if (parts.length !== 5) return customResult;

  const [minute, hour, day, month, weekday] = parts;

  // Structured modes currently only map from the common day/month wildcard families.
  if (day !== '*' || month !== '*') return customResult;

  const parsedMinute = Number.parseInt(minute, 10);

  if (minute !== String(parsedMinute) || Number.isNaN(parsedMinute)) return customResult;
  if (parsedMinute < 0 || parsedMinute > 59) return customResult;

  // Hourly: M * * * * or M */N * * *
  if (weekday === '*') {
    if (hour === '*') {
      return {
        hourlyInterval: 1,
        scheduleType: 'hourly',
        triggerHour: 0,
        triggerMinute: parsedMinute,
      };
    }

    if (hour.startsWith('*/')) {
      const interval = Number.parseInt(hour.slice(2), 10);
      if (!Number.isNaN(interval) && interval > 0) {
        return {
          hourlyInterval: interval,
          scheduleType: 'hourly',
          triggerHour: 0,
          triggerMinute: parsedMinute,
        };
      }
      return customResult;
    }

    const parsedHour = Number.parseInt(hour, 10);
    if (hour !== String(parsedHour) || Number.isNaN(parsedHour)) return customResult;
    if (parsedHour < 0 || parsedHour > 23) return customResult;

    return {
      scheduleType: 'daily',
      triggerHour: parsedHour,
      triggerMinute: parsedMinute,
    };
  }

  // Weekly: M H * * D[,D...]
  const parsedHour = Number.parseInt(hour, 10);
  if (hour !== String(parsedHour) || Number.isNaN(parsedHour)) return customResult;
  if (parsedHour < 0 || parsedHour > 23) return customResult;

  const weekdays = weekday
    .split(',')
    .map((item) => Number.parseInt(item, 10))
    .map((value) => (value === 7 ? 0 : value));

  if (weekdays.some((value) => Number.isNaN(value) || value < 0 || value > 6)) {
    return customResult;
  }

  return {
    scheduleType: 'weekly',
    triggerHour: parsedHour,
    triggerMinute: parsedMinute,
    weekdays,
  };
};

/**
 * Build cron pattern from schedule info
 * Format: minute hour day month weekday
 */
export const buildCronPattern = (
  scheduleType: ScheduleType,
  triggerTime: Dayjs,
  hourlyInterval?: number,
  weekdays?: number[],
  customCronPattern?: string,
): string => {
  if (scheduleType === 'custom') {
    return customCronPattern?.trim() || '';
  }

  const minute = triggerTime.minute();
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
        weekdays && weekdays.length > 0 ? [...weekdays].sort().join(',') : '0,1,2,3,4,5,6';
      return `${minute} ${hour} * * ${days}`;
    }
  }
};
