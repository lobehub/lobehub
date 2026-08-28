import type { ClaudeCodeScopedWeekly, HeteroQuotaWindow } from './snapshot';
import type { QuotaLimitReading } from './types';
import { windowSecondsForKind } from './types';

/**
 * The subset of a limit reading the display path needs. A live sample and a
 * persisted `agent_quota_snapshots` row both satisfy it, so the panel can run
 * the two through exactly the same rules instead of one set for each.
 */
export type QuotaDisplayReading = Pick<
  QuotaLimitReading,
  'capturedAt' | 'limitType' | 'resetsAt' | 'scopeKey' | 'utilization'
>;

const clampPercent = (value: number) => Math.min(100, Math.max(0, Math.round(value)));

/**
 * Whether the window a reading describes has already rolled over — i.e. the
 * quota it measured has since refilled.
 *
 * `resets_at` is the provider's own window boundary, so a boundary in the past
 * settles it. Some limits arrive without one (an untouched model-scoped weekly
 * reports `resets_at: null`), and those can only speak for the window they were
 * captured in — so a reading older than one full window counts as rolled over
 * too.
 */
export const hasWindowRolledOver = (reading: QuotaDisplayReading, now: number): boolean =>
  reading.resetsAt == null
    ? now - reading.capturedAt > windowSecondsForKind(reading.limitType) * 1000
    : reading.resetsAt <= now;

/**
 * Utilization of the window that is live *now*: a rolled-over window refilled,
 * so it reads 0 rather than replaying the spent window's last value.
 */
export const currentUtilization = (reading: QuotaDisplayReading, now: number): number =>
  hasWindowRolledOver(reading, now) ? 0 : clampPercent(reading.utilization);

/**
 * A reading as a display window. A rolled-over window is reported as refilled
 * (0% used, no countdown) rather than dropped: hiding the row reads as "this
 * plan has no such limit", while replaying its last utilization paints an
 * exhausted meter over a quota that is actually free.
 */
export const toQuotaWindow = (reading: QuotaDisplayReading, now: number): HeteroQuotaWindow => {
  const rolledOver = hasWindowRolledOver(reading, now);

  return {
    resetsAt: rolledOver ? null : (reading.resetsAt ?? null),
    usedPercent: rolledOver ? 0 : clampPercent(reading.utilization),
    windowMinutes: windowSecondsForKind(reading.limitType) / 60,
  };
};

/** The 5-hour window; `five_hour` is the pre-`limits[]` spelling. */
export const isSessionLimit = (reading: QuotaDisplayReading): boolean =>
  reading.limitType === 'session' || reading.limitType === 'five_hour';

/**
 * The account-wide weekly window. Anthropic has renamed this kind before
 * (`seven_day` → `weekly_all`), so key off "weekly and unscoped" rather than
 * one literal.
 */
export const isWeeklyAllLimit = (reading: QuotaDisplayReading): boolean =>
  reading.limitType.startsWith('weekly') && !reading.scopeKey;

/** A weekly window scoped to one model, e.g. Fable. */
export const isScopedWeeklyLimit = (reading: QuotaDisplayReading): boolean =>
  reading.limitType.startsWith('weekly') && !!reading.scopeKey;

const newestMatch = <T extends QuotaDisplayReading>(
  readings: T[],
  match: (reading: T) => boolean,
): T | undefined =>
  readings.reduce<T | undefined>(
    (newest, reading) =>
      match(reading) && (!newest || reading.capturedAt > newest.capturedAt) ? reading : newest,
    undefined,
  );

export interface ClaudeQuotaWindows {
  scopedWeekly: ClaudeCodeScopedWeekly | null;
  session: HeteroQuotaWindow | null;
  weekly: HeteroQuotaWindow | null;
}

/**
 * Project limit readings onto the three windows the Claude panel renders. The
 * single source of that mapping: the live sampler and the persisted read model
 * both go through here, so a limit can never be visible on one path and
 * missing on the other.
 */
export const buildClaudeQuotaWindows = (
  readings: QuotaDisplayReading[],
  now: number,
): ClaudeQuotaWindows => {
  const session = newestMatch(readings, isSessionLimit);
  const weekly = newestMatch(readings, isWeeklyAllLimit);
  const scoped = newestMatch(readings, isScopedWeeklyLimit);

  return {
    scopedWeekly: scoped
      ? { modelName: scoped.scopeKey, window: toQuotaWindow(scoped, now) }
      : null,
    session: session ? toQuotaWindow(session, now) : null,
    weekly: weekly ? toQuotaWindow(weekly, now) : null,
  };
};
