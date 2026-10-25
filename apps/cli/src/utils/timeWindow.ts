const RELATIVE_PATTERN = /^(\d+)\s*([hdwm])$/i;
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const LEADING_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})/;

const UNIT_MS: Record<string, number> = {
  d: 24 * 60 * 60 * 1000,
  h: 60 * 60 * 1000,
  m: 30 * 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
};

export const TIME_POINT_HELP = 'ISO time, YYYY-MM-DD (local day), or relative: 24h, 7d, 2w, 1m';

/**
 * Parse a `--since` / `--until` value. Relative values count back from `now`;
 * a bare date is a local calendar day, so `--until 2026-10-18` includes that
 * whole day. Throws on anything else so a typo never silently widens a search.
 */
export function parseTimePoint(value: string, edge: 'end' | 'start', now: Date = new Date()): Date {
  const text = value.trim();

  const relative = text.match(RELATIVE_PATTERN);
  if (relative) {
    return new Date(now.getTime() - Number(relative[1]) * UNIT_MS[relative[2].toLowerCase()]);
  }

  // `Date` rolls impossible days over (2026-02-31 becomes March 3) for both
  // bare dates and ISO strings, which would silently shift the window.
  const leadingDate = text.match(LEADING_DATE_PATTERN);
  if (
    leadingDate &&
    !isCalendarDate(...(leadingDate.slice(1).map(Number) as [number, number, number]))
  ) {
    throw new Error(`Invalid time "${value}": no such calendar date.`);
  }

  const dateOnly = text.match(DATE_ONLY_PATTERN);
  if (dateOnly) {
    const [year, month, day] = dateOnly.slice(1).map(Number);
    return edge === 'start'
      ? new Date(year, month - 1, day, 0, 0, 0, 0)
      : new Date(year, month - 1, day, 23, 59, 59, 999);
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid time "${value}". Use ${TIME_POINT_HELP}.`);
  }
  return parsed;
}

function isCalendarDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

export interface TimeWindow {
  endDate?: Date;
  startDate?: Date;
}

export function parseTimeWindow(options: { since?: string; until?: string }): TimeWindow {
  const window: TimeWindow = {};
  if (options.since) window.startDate = parseTimePoint(options.since, 'start');
  if (options.until) window.endDate = parseTimePoint(options.until, 'end');
  if (window.startDate && window.endDate && window.startDate > window.endDate) {
    throw new Error('--since must be earlier than --until.');
  }
  return window;
}
