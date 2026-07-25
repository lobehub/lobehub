/**
 * Pure, dependency-free quota primitives shared by the desktop sampler and the
 * server calibration/projection. No DB, no fs, no network — everything here is
 * a plain function over plain data so it is trivially unit-testable.
 */

/** Provider account identity parsed from local CLI config. */
export interface QuotaAccountIdentity {
  displayName?: string;
  email?: string;
  /** Anthropic accountUuid / Codex account_id. */
  externalAccountId?: string;
  organizationId?: string;
  /** Normalized plan, e.g. `max` / `pro`. */
  planTier?: string;
  rateLimitTier?: string;
}

/** Per-turn token counts, cache tiers kept separate (they price differently). */
export interface QuotaTokenUsage {
  cacheRead?: number;
  /** 1-hour ephemeral cache write (2x input). */
  cacheWrite1h?: number;
  /** 5-minute ephemeral cache write (1.25x input). */
  cacheWrite5m?: number;
  input?: number;
  output?: number;
  reasoning?: number;
}

/**
 * $ per million tokens. Only `input`/`output` are required; cache tiers default
 * to Anthropic's fixed multipliers of the input rate (read 0.1x, 5m-write
 * 1.25x, 1h-write 2x) but can be overridden with exact model-bank rates.
 */
export interface QuotaModelPrice {
  cacheRead?: number;
  cacheWrite1h?: number;
  cacheWrite5m?: number;
  input: number;
  output: number;
}

/** One provider utilization reading for a single limit bucket. */
export interface QuotaLimitReading {
  /** ms epoch when this reading was captured. */
  capturedAt: number;
  isActive?: boolean;
  /** Raw `limits[].kind`, e.g. `session` / `weekly_all` / `weekly_scoped`. */
  limitType: string;
  /** True if a real 429 was observed at/around this reading. */
  rateLimited?: boolean;
  /** ms epoch of the window reset, or null if the provider didn't report one. */
  resetsAt: number | null;
  /** Model display name for scoped windows; `''` otherwise. */
  scopeKey: string;
  severity?: string;
  /** Integer percent 0..100. */
  utilization: number;
}

/** A projected concrete window, keyed by (limitType, scopeKey, resetsAt). */
export interface QuotaWindowProjection {
  firstSeenAt: number;
  lastSeenAt: number;
  lastUtilization: number;
  limitType: string;
  peakUtilization: number;
  rateLimitedAt: number | null;
  resetsAt: number;
  scopeKey: string;
  windowSeconds: number;
  windowStartAt: number;
}

export interface QuotaCalibrationResult {
  /** Capacity in provider-equivalent USD (the stable unit). */
  capacityUsd: number;
  /** 0..1, grows with sample count and shrinks with dispersion. */
  confidence: number;
  method: string;
  sampleCount: number;
}

/** Window length per limit kind, in seconds. */
export const CLAUDE_SESSION_WINDOW_SECONDS = 5 * 60 * 60;
export const CLAUDE_WEEKLY_WINDOW_SECONDS = 7 * 24 * 60 * 60;

/**
 * Resolve the window length for a Claude limit kind. Anything starting with
 * `weekly` is the 7-day window; everything else is the 5-hour session window.
 */
export const windowSecondsForKind = (limitType: string): number =>
  limitType.startsWith('weekly') ? CLAUDE_WEEKLY_WINDOW_SECONDS : CLAUDE_SESSION_WINDOW_SECONDS;
