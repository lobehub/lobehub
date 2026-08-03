import type { BudgetPeriod } from '@/database/utils/aicoMoney';

/**
 * OpenRouter resets periodic key limits at midnight UTC
 * (weeks = Monday 00:00 UTC → Sunday).
 * Aico period boundaries must mirror those UTC boundaries — never Iran-local midnight.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const startOfUtcDay = (d: Date): Date =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));

/** Monday 00:00 UTC of the week containing `d`. */
const startOfUtcWeekMonday = (d: Date): Date => {
  const day = startOfUtcDay(d);
  // getUTCDay: 0=Sun … 6=Sat → convert so Monday=0
  const mondayOffset = (day.getUTCDay() + 6) % 7;
  return new Date(day.getTime() - mondayOffset * DAY_MS);
};

const startOfUtcMonth = (d: Date): Date =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0));

export interface PeriodWindow {
  start: Date;
  end: Date;
  nextRenewalAt: Date;
}

export const computePeriodWindow = (period: BudgetPeriod, now = new Date()): PeriodWindow => {
  switch (period) {
    case 'daily': {
      const start = startOfUtcDay(now);
      const end = new Date(start.getTime() + DAY_MS);
      return { start, end, nextRenewalAt: end };
    }
    case 'weekly': {
      const start = startOfUtcWeekMonday(now);
      const end = new Date(start.getTime() + 7 * DAY_MS);
      return { start, end, nextRenewalAt: end };
    }
    case 'monthly': {
      const start = startOfUtcMonth(now);
      const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1, 0, 0, 0, 0));
      return { start, end, nextRenewalAt: end };
    }
    case 'total': {
      // No automatic reset — treat as open-ended until manually settled/revoked.
      const start = now;
      const end = new Date(Date.UTC(9999, 0, 1, 0, 0, 0, 0));
      return { start, end, nextRenewalAt: end };
    }
    default: {
      const _exhaustive: never = period;
      throw new Error(`UNKNOWN_PERIOD:${_exhaustive}`);
    }
  }
};

/** Format a UTC instant for UI (caller converts to local timezone for display). */
export const formatUtcIso = (d: Date): string => d.toISOString();
