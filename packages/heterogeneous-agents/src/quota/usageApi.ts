import type { QuotaLimitReading } from './types';

/**
 * Shape of a single entry in the `/api/oauth/usage` `limits[]` array. This is
 * the generalized form the account panel should key off — Anthropic adds and
 * removes top-level codenames (`tangelo`, `seven_day_opus`, …) freely, but the
 * `limits[]` rows stay a stable `{ kind, group, percent, scope }` shape.
 */
export interface ClaudeUsageLimit {
  is_active?: boolean;
  kind?: string;
  percent?: number;
  resets_at?: number | string | null;
  scope?: { model?: { display_name?: string | null } | null } | null;
  severity?: string;
}

export interface ClaudeUsageWindow {
  resets_at?: number | string | null;
  used_percentage?: number;
  utilization?: number;
}

export interface ClaudeUsagePayload {
  five_hour?: ClaudeUsageWindow | null;
  limits?: ClaudeUsageLimit[];
  seven_day?: ClaudeUsageWindow | null;
}

/** < 1e12 → epoch seconds; otherwise already epoch ms. */
const epochToMs = (value: number): number => (value < 1e12 ? value * 1000 : value);

/** Parse `resets_at` in any of the forms the API emits: ISO string, s, or ms. */
export const parseResetsAt = (value: number | string | null | undefined): number | null => {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? epochToMs(value) : null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  // The API types resets_at as `number | string`, so an epoch can arrive quoted.
  // Handle it before Date.parse, which returns NaN for "1784613216" and — worse —
  // reads a short digit string like "1784" as a year.
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const numeric = Number(trimmed);
    return Number.isFinite(numeric) ? epochToMs(numeric) : null;
  }

  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
};

const utilOf = (w: ClaudeUsageWindow | null | undefined): number =>
  Math.round(w?.utilization ?? w?.used_percentage ?? 0);

/**
 * Convert a `/api/oauth/usage` response into flat limit readings for
 * persistence. Prefers the generalized `limits[]` array; falls back to the
 * legacy `five_hour` / `seven_day` fields when `limits[]` is absent.
 */
export const mapClaudeUsageToReadings = (
  payload: ClaudeUsagePayload,
  capturedAt: number,
): QuotaLimitReading[] => {
  if (Array.isArray(payload.limits) && payload.limits.length > 0) {
    return payload.limits
      .filter((l): l is ClaudeUsageLimit & { kind: string } => typeof l.kind === 'string')
      .map((l) => ({
        capturedAt,
        isActive: l.is_active,
        limitType: l.kind,
        resetsAt: parseResetsAt(l.resets_at),
        scopeKey: l.scope?.model?.display_name ?? '',
        severity: l.severity,
        utilization: Math.round(l.percent ?? 0),
      }));
  }

  const readings: QuotaLimitReading[] = [];
  if (payload.five_hour) {
    readings.push({
      capturedAt,
      limitType: 'session',
      resetsAt: parseResetsAt(payload.five_hour.resets_at),
      scopeKey: '',
      utilization: utilOf(payload.five_hour),
    });
  }
  if (payload.seven_day) {
    readings.push({
      capturedAt,
      limitType: 'weekly_all',
      resetsAt: parseResetsAt(payload.seven_day.resets_at),
      scopeKey: '',
      utilization: utilOf(payload.seven_day),
    });
  }
  return readings;
};
