import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';

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
