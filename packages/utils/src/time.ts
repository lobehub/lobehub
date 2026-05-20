import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

const getQuarterStart = (date: Dayjs) => {
  const month = date.month();
  const quarterStartMonth = Math.floor(month / 3) * 3;
  return date.month(quarterStartMonth).startOf('month');
};

export const today = () => dayjs().startOf('day');
export const thisWeek = () => dayjs().startOf('week');
export const thisMonth = () => dayjs().startOf('month');
export const thisQuarter = () => getQuarterStart(today());
export const thisYear = () => dayjs().startOf('year');

export const hoursAgo = (hours: number) => dayjs().subtract(hours, 'hours').startOf('hours');

export const daysAgo = (days: number) => dayjs().subtract(days, 'days').startOf('day');

export const weeksAgo = (weeks: number) => dayjs().subtract(weeks, 'week').startOf('week');

export const monthsAgo = (months: number) => dayjs().subtract(months, 'month').startOf('month');

export const lastMonth = () => monthsAgo(1).endOf('month');

/**
 * Get the date in the format of YYYYMMdd_HHmmss like 20240101_235959
 *
 * @example
 *
 * ```ts
 * getYYYYmmddHHMMss(new Date('2024-01-01 23:59:59')); // returns '20240101_235959'
 * getYYYYmmddHHMMss(new Date('2024-12-31 00:00:00')); // returns '20241231_000000'
 * ```
 *
 * @param date - The date to format
 * @returns A string in YYYYMMdd_HHmmss format with underscore separator between date and time
 * @see https://day.js.org/docs/en/display/format
 */
export function getYYYYmmddHHMMss(date: Date) {
  return dayjs(date).format('YYYYMMDD_HHmmss');
}

export const isNewReleaseDate = (date: string, days = 14) => {
  return dayjs().diff(dayjs(date), 'day') < days;
};

export interface FormatActivityTimeOptions {
  formatOtherYear?: string;
  formatThisYear?: string;
  fullDateTimeFormat?: string;
  now?: Date | string | number;
  /** Threshold (ms) below which `from()` is used. Default: 1 day. */
  relativeThresholdMs?: number;
}

export interface FormattedActivityTime {
  /** Short label rendered inline. */
  text: string;
  /** Full datetime, intended for the native `title` tooltip. */
  title: string;
}

const ACTIVITY_TIME_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Format a timestamp for an activity-feed entry: relative (`from()`) when
 * recent, absolute date (`Apr 29` / `4月29日`) once the gap crosses one day.
 */
export const formatActivityTime = (
  time?: string | Date | number | null,
  options: FormatActivityTimeOptions = {},
): FormattedActivityTime => {
  if (!time) return { text: '', title: '' };
  const date = dayjs(time);
  if (!date.isValid()) return { text: '', title: '' };

  const {
    formatOtherYear = 'MMM D, YYYY',
    formatThisYear = 'MMM D',
    fullDateTimeFormat = 'YYYY-MM-DD HH:mm:ss',
    now = new Date(),
    relativeThresholdMs = ACTIVITY_TIME_DAY_MS,
  } = options;

  const current = dayjs(now);
  const diff = Math.abs(current.diff(date));
  const text =
    diff < relativeThresholdMs
      ? date.from(current)
      : date.format(date.isSame(current, 'year') ? formatThisYear : formatOtherYear);

  return { text, title: date.format(fullDateTimeFormat) };
};
