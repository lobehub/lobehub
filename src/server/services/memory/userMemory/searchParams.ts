import type { SearchMemoryParams, SearchMemoryTimeIntent } from '@lobechat/types';

const DAY_MS = 24 * 60 * 60 * 1000;

const startOfUtcDay = (value: Date) =>
  new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));

const endOfUtcDay = (value: Date) =>
  new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate(), 23, 59, 59, 999),
  );

const addUtcDays = (value: Date, days: number) =>
  new Date(startOfUtcDay(value).getTime() + days * DAY_MS);

const startOfUtcMonth = (year: number, monthIndex: number) =>
  new Date(Date.UTC(year, monthIndex, 1));

const endOfUtcMonth = (year: number, monthIndex: number) =>
  new Date(Date.UTC(year, monthIndex + 1, 0, 23, 59, 59, 999));

const startOfUtcYear = (year: number) => new Date(Date.UTC(year, 0, 1));

const endOfUtcYear = (year: number) => new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));

const startOfUtcWeek = (value: Date) => {
  const day = value.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;

  return addUtcDays(value, diff);
};

type RelativeDayIntent = Extract<SearchMemoryTimeIntent, { selector: 'relativeDay' }>;

const resolveRelativeDayAnchor = (anchor: RelativeDayIntent['anchor'], now: Date) => {
  if (anchor === 'today') return now;
  if (anchor === 'yesterday') return addUtcDays(now, -1);

  const timeRange = resolveTimeIntent(anchor, now);

  return timeRange?.start ?? timeRange?.end;
};

export const resolveTimeIntent = (
  timeIntent: SearchMemoryTimeIntent,
  now = new Date(),
): SearchMemoryParams['timeRange'] | undefined => {
  const field = 'createdAt';

  switch (timeIntent.selector) {
    case 'today': {
      return { end: endOfUtcDay(now), field, start: startOfUtcDay(now) };
    }
    case 'yesterday': {
      const date = addUtcDays(now, -1);

      return { end: endOfUtcDay(date), field, start: startOfUtcDay(date) };
    }
    case 'currentWeek': {
      const start = startOfUtcWeek(now);
      const end = endOfUtcDay(addUtcDays(start, 6));

      return { end, field, start };
    }
    case 'lastWeek': {
      const start = addUtcDays(startOfUtcWeek(now), -7);
      const end = endOfUtcDay(addUtcDays(start, 6));

      return { end, field, start };
    }
    case 'lastWeekend': {
      const currentWeekStart = startOfUtcWeek(now);
      const start = addUtcDays(currentWeekStart, -2);
      const end = endOfUtcDay(addUtcDays(currentWeekStart, -1));

      return { end, field, start };
    }
    case 'lastWeekdays': {
      const start = addUtcDays(startOfUtcWeek(now), -7);
      const end = endOfUtcDay(addUtcDays(start, 4));

      return { end, field, start };
    }
    case 'currentMonth': {
      const year = now.getUTCFullYear();
      const monthIndex = now.getUTCMonth();

      return {
        end: endOfUtcMonth(year, monthIndex),
        field,
        start: startOfUtcMonth(year, monthIndex),
      };
    }
    case 'lastMonth': {
      const currentMonthStart = startOfUtcMonth(now.getUTCFullYear(), now.getUTCMonth());
      const lastMonth = new Date(
        Date.UTC(currentMonthStart.getUTCFullYear(), currentMonthStart.getUTCMonth() - 1, 1),
      );
      const year = lastMonth.getUTCFullYear();
      const monthIndex = lastMonth.getUTCMonth();

      return {
        end: endOfUtcMonth(year, monthIndex),
        field,
        start: startOfUtcMonth(year, monthIndex),
      };
    }
    case 'currentYear': {
      const year = now.getUTCFullYear();

      return { end: endOfUtcYear(year), field, start: startOfUtcYear(year) };
    }
    case 'lastYear': {
      const year = now.getUTCFullYear() - 1;

      return { end: endOfUtcYear(year), field, start: startOfUtcYear(year) };
    }
    case 'day': {
      return { end: endOfUtcDay(timeIntent.date), field, start: startOfUtcDay(timeIntent.date) };
    }
    case 'month': {
      const monthIndex = timeIntent.month - 1;

      return {
        end: endOfUtcMonth(timeIntent.year, monthIndex),
        field,
        start: startOfUtcMonth(timeIntent.year, monthIndex),
      };
    }
    case 'year': {
      return { end: endOfUtcYear(timeIntent.year), field, start: startOfUtcYear(timeIntent.year) };
    }
    case 'relativeDay': {
      const anchorDate = resolveRelativeDayAnchor(timeIntent.anchor, now);

      if (!anchorDate) return;

      const date = addUtcDays(anchorDate, timeIntent.offsetDays);

      return { end: endOfUtcDay(date), field, start: startOfUtcDay(date) };
    }
    case 'range': {
      return {
        end: timeIntent.end ? endOfUtcDay(timeIntent.end) : undefined,
        field,
        start: timeIntent.start ? startOfUtcDay(timeIntent.start) : undefined,
      };
    }
  }
};

export const normalizeSearchMemoryParams = (
  params: SearchMemoryParams,
  now = new Date(),
): SearchMemoryParams => {
  if (params.timeRange || !params.timeIntent) return params;

  return {
    ...params,
    timeIntent: undefined,
    timeRange: resolveTimeIntent(params.timeIntent, now),
  };
};
