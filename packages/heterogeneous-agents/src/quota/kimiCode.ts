import type { QuotaDisplayReading } from './readings';
import { toQuotaWindow } from './readings';
import type { HeteroQuotaWindow } from './snapshot';
import type { QuotaLimitReading } from './types';

export const KIMI_CODE_SESSION_WINDOW_MINUTES = 5 * 60;
export const KIMI_CODE_WEEKLY_WINDOW_MINUTES = 7 * 24 * 60;
export const KIMI_CODE_MONTHLY_WINDOW_MINUTES = 30 * 24 * 60;

export interface KimiCodeQuotaWindows {
  monthly: HeteroQuotaWindow | null;
  monthlyCode: HeteroQuotaWindow | null;
  session: HeteroQuotaWindow | null;
  weekly: HeteroQuotaWindow | null;
}

/** Preserve provider limit kinds and window lengths across live and persisted views. */
export const kimiCodeQuotaReadings = (
  windows: KimiCodeQuotaWindows,
  capturedAt: number,
): QuotaLimitReading[] => {
  const slots: [limitType: string, window: HeteroQuotaWindow | null, windowMinutes: number][] = [
    ['session', windows.session, KIMI_CODE_SESSION_WINDOW_MINUTES],
    ['weekly_all', windows.weekly, KIMI_CODE_WEEKLY_WINDOW_MINUTES],
    ['month_total', windows.monthly, KIMI_CODE_MONTHLY_WINDOW_MINUTES],
    ['month_code', windows.monthlyCode, KIMI_CODE_MONTHLY_WINDOW_MINUTES],
  ];

  return slots.flatMap(([limitType, window, windowMinutes]) =>
    window
      ? [
          {
            capturedAt,
            limitType,
            resetsAt: window.resetsAt,
            scopeKey: '',
            utilization: Math.round(window.usedPercent),
            windowMinutes,
          },
        ]
      : [],
  );
};

/**
 * Project limit readings onto the four windows the Kimi Code panel renders. The
 * single source of that mapping: the live sampler and the persisted read model
 * both go through here, so a limit can never be visible on one path and
 * missing on the other.
 */
export const buildKimiCodeQuotaWindows = (
  readings: QuotaDisplayReading[],
  now: number,
): KimiCodeQuotaWindows => {
  const newest = new Map<string, QuotaDisplayReading>();
  for (const reading of readings) {
    if (
      reading.limitType !== 'session' &&
      reading.limitType !== 'weekly_all' &&
      reading.limitType !== 'month_total' &&
      reading.limitType !== 'month_code'
    )
      continue;
    const previous = newest.get(reading.limitType);
    if (!previous || previous.capturedAt < reading.capturedAt)
      newest.set(reading.limitType, reading);
  }

  const window = (limitType: string) => {
    const reading = newest.get(limitType);
    return reading ? toQuotaWindow(reading, now) : null;
  };

  return {
    monthly: window('month_total'),
    monthlyCode: window('month_code'),
    session: window('session'),
    weekly: window('weekly_all'),
  };
};
