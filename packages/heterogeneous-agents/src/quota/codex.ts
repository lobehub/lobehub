import { toQuotaWindow } from './readings';
import type { CodexRateLimitSnapshot } from './snapshot';
import type { QuotaLimitReading } from './types';

/** Preserve provider bucket ids and window lengths across live and persisted views. */
export const codexQuotaReadings = (
  limits: CodexRateLimitSnapshot[],
  capturedAt: number,
): QuotaLimitReading[] =>
  limits.flatMap((limit) => {
    const readings: QuotaLimitReading[] = [];
    for (const [slot, window] of [
      ['primary', limit.primary],
      ['secondary', limit.secondary],
    ] as const) {
      if (!window) continue;
      readings.push({
        capturedAt,
        limitName: limit.limitName,
        limitType: slot === 'primary' ? 'session' : 'weekly_all',
        resetsAt: window.resetsAt,
        scopeKey: limit.limitId.toLowerCase() === 'codex' ? '' : limit.limitId,
        utilization: Math.round(window.usedPercent),
        windowMinutes: window.windowMinutes,
      });
    }
    return readings;
  });

export const buildCodexRateLimits = (
  readings: QuotaLimitReading[],
  now: number,
): CodexRateLimitSnapshot[] => {
  const newest = new Map<string, QuotaLimitReading>();
  for (const reading of readings) {
    if (reading.limitType !== 'session' && reading.limitType !== 'weekly_all') continue;
    const key = JSON.stringify([reading.limitType, reading.scopeKey]);
    const previous = newest.get(key);
    if (!previous || previous.capturedAt < reading.capturedAt) newest.set(key, reading);
  }
  const limits = new Map<string, CodexRateLimitSnapshot>();
  for (const reading of newest.values()) {
    const id = reading.scopeKey || 'codex';
    const limit = limits.get(id) ?? {
      limitId: id,
      limitName: reading.limitName ?? null,
      primary: null,
      secondary: null,
    };
    limit[reading.limitType === 'session' ? 'primary' : 'secondary'] = toQuotaWindow(reading, now);
    limits.set(id, limit);
  }
  return [...limits.values()];
};
