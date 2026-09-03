import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import type { SQL } from 'drizzle-orm';
import { and, gte, lte } from 'drizzle-orm';

export const genWhere = (sqls: (SQL<any> | undefined)[]): SQL<any> | undefined => {
  const where = sqls.filter(Boolean);
  if (where.length > 1) return and(...where);
  return where[0];
};

export const genStartDateWhere = (
  date: string | undefined,
  key: any,
  format: (date: Dayjs) => any,
): SQL | undefined => {
  if (!date || !dayjs(date).isValid()) return;
  return gte(key, format(dayjs(new Date(date))));
};

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export const genEndDateWhere = (
  date: string | undefined,
  key: any,
  format: (date: Dayjs) => any,
): SQL | undefined => {
  if (!date || !dayjs(date).isValid()) return;
  // A date-only value means "through the end of that day", so push the bound
  // one day forward; a precise timestamp is used as the exact upper bound.
  const end = DATE_ONLY.test(date.trim())
    ? dayjs(new Date(date)).add(1, 'day')
    : dayjs(new Date(date));
  return lte(key, format(end));
};

export const genRangeWhere = (
  range: [string, string] | undefined,
  key: any,
  format: (date: Dayjs) => any,
): SQL | undefined => {
  if (!range) return;
  if (!dayjs(range[0]).isValid() && !dayjs(range[1]).isValid()) return;
  if (!dayjs(range[0]).isValid()) return genEndDateWhere(range[1], key, format);
  if (!dayjs(range[1]).isValid()) return genStartDateWhere(range[0], key, format);
  return and(genStartDateWhere(range[0], key, format), genEndDateWhere(range[1], key, format));
};
