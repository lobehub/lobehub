import { type Dayjs } from 'dayjs';

export type ScheduleType = 'daily' | 'hourly' | 'weekly';

export const SCHEDULE_TYPE_OPTIONS = [
  { label: 'taskSchedule.scheduleType.daily', value: 'daily' },
  { label: 'taskSchedule.scheduleType.hourly', value: 'hourly' },
  { label: 'taskSchedule.scheduleType.weekly', value: 'weekly' },
] as const;

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

export const WEEKDAYS = [
  { key: 1, label: 'taskSchedule.weekdays.mon' },
  { key: 2, label: 'taskSchedule.weekdays.tue' },
  { key: 3, label: 'taskSchedule.weekdays.wed' },
  { key: 4, label: 'taskSchedule.weekdays.thu' },
  { key: 5, label: 'taskSchedule.weekdays.fri' },
  { key: 6, label: 'taskSchedule.weekdays.sat' },
  { key: 0, label: 'taskSchedule.weekdays.sun' },
] as const;

/**
 * Parse cron pattern (minute hour day month weekday) into editable schedule info.
 */
export const parseCronPattern = (
  cronPattern: string,
): {
  hourlyInterval?: number;
  scheduleType: ScheduleType;
  triggerHour: number;
  triggerMinute: number;
  weekdays?: number[];
} => {
  const parts = cronPattern.split(' ');
  if (parts.length !== 5) {
    return { scheduleType: 'daily', triggerHour: 0, triggerMinute: 0 };
  }

  const [minute, hour, , , weekday] = parts;
  const rawMinute = minute === '*' ? 0 : Number.parseInt(minute);
  const triggerMinute = rawMinute >= 15 && rawMinute < 45 ? 30 : 0;

  if (hour.startsWith('*/')) {
    const interval = Number.parseInt(hour.slice(2));
    return { hourlyInterval: interval, scheduleType: 'hourly', triggerHour: 0, triggerMinute };
  }
  if (hour === '*') {
    return { hourlyInterval: 1, scheduleType: 'hourly', triggerHour: 0, triggerMinute };
  }

  const triggerHour = Number.parseInt(hour);

  if (weekday !== '*') {
    const weekdays = weekday.split(',').map((d) => Number.parseInt(d));
    return { scheduleType: 'weekly', triggerHour, triggerMinute, weekdays };
  }

  return { scheduleType: 'daily', triggerHour, triggerMinute };
};

/**
 * Build cron pattern (minute hour day month weekday) from editable schedule info.
 */
export const buildCronPattern = (
  scheduleType: ScheduleType,
  triggerTime: Dayjs,
  hourlyInterval?: number,
  weekdays?: number[],
): string => {
  const rawMinute = triggerTime.minute();
  const minute = rawMinute >= 15 && rawMinute < 45 ? 30 : 0;
  const hour = triggerTime.hour();

  switch (scheduleType) {
    case 'hourly': {
      const interval = hourlyInterval || 1;
      if (interval === 1) return `${minute} * * * *`;
      return `${minute} */${interval} * * *`;
    }
    case 'daily': {
      return `${minute} ${hour} * * *`;
    }
    case 'weekly': {
      const days = weekdays && weekdays.length > 0 ? weekdays.sort().join(',') : '0,1,2,3,4,5,6';
      return `${minute} ${hour} * * ${days}`;
    }
  }
};
