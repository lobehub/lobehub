import type { QuotaAccountIdentity, QuotaLimitReading } from './types';

/**
 * Provider-quota snapshot shapes shared by every sampler host: the desktop
 * main process (IPC), connected devices (`lh connect` RPC), and the web client
 * that renders them. Pure types — the Node-only fetch lives in
 * `../quota-sampler`.
 */
export interface HeteroQuotaWindow {
  resetsAt: number | null;
  usedPercent: number;
  windowMinutes: number;
}

export type CodexQuotaWindow = HeteroQuotaWindow;

export interface CodexRateLimitSnapshot {
  /** Canonical metered limit identifier, for example `codex` or `codex_other`. */
  limitId: string;
  limitName: string | null;
  primary: CodexQuotaWindow | null;
  secondary: CodexQuotaWindow | null;
}

export interface CodexRateLimitResetCredit {
  expiresAt: number | null;
  grantedAt: number | null;
  /** Opaque backend identifier used only when redeeming this specific credit. */
  id: string | null;
  redeemedAt?: number | null;
  redeemStartedAt?: number | null;
  resetType: string | null;
  status: string;
  title: string | null;
}

export interface CodexRateLimitResetCredits {
  availableCount: number;
  /** Detailed rows when supported by the installed Codex CLI/backend. */
  credits?: CodexRateLimitResetCredit[];
  nextExpiresAt?: number | null;
  totalEarnedCount?: number;
}

export interface CodexQuotaSnapshot {
  error: string | null;
  identity?: QuotaAccountIdentity | null;
  provider: 'codex';
  rateLimitResetCredits?: CodexRateLimitResetCredits | null;
  /** Complete multi-bucket view when supported by the installed Codex app-server. */
  rateLimits?: CodexRateLimitSnapshot[];
  readings?: QuotaLimitReading[];
  session: CodexQuotaWindow | null;
  status: 'error' | 'ok' | 'unavailable';
  updatedAt: number;
  weekly: CodexQuotaWindow | null;
}

export type CodexRateLimitResetOutcome =
  'alreadyRedeemed' | 'noCredit' | 'nothingToReset' | 'reset';

/**
 * Why the quota can't be shown. `external-auth` means the agent is configured
 * with an API key / custom base url, so subscription quota does not apply;
 * the credential reasons mean no fresh OAuth login was found on this machine.
 */
export type ClaudeCodeQuotaUnavailableReason =
  'credentials-expired' | 'credentials-not-found' | 'external-auth';

export interface ClaudeCodeScopedWeekly {
  /** Display name of the model the window is scoped to, e.g. "Fable". */
  modelName: string;
  window: HeteroQuotaWindow;
}

/** Account identity resolved from the local CLI config, for DB persistence. */
export type ClaudeCodeAccountIdentity = QuotaAccountIdentity;

/** One raw limit reading, for fossilizing into the quota data layer. */
export type ClaudeCodeQuotaReading = QuotaLimitReading;

export interface ClaudeCodeQuotaSnapshot {
  error: string | null;
  /** Present when `status === 'ok'` and the local config carries an account. */
  identity?: ClaudeCodeAccountIdentity | null;
  provider: 'claude-code';
  /** Flat limit readings for DB persistence (mirrors `session`/`weekly`/scoped). */
  readings?: ClaudeCodeQuotaReading[];
  reason?: ClaudeCodeQuotaUnavailableReason;
  /** Model-scoped weekly window (e.g. Fable/Opus), when the plan reports one. */
  scopedWeekly: ClaudeCodeScopedWeekly | null;
  session: HeteroQuotaWindow | null;
  status: 'error' | 'ok' | 'unavailable';
  updatedAt: number;
  weekly: HeteroQuotaWindow | null;
}

/** Booster-wallet top-up balance reported alongside the Kimi Code rate limits. */
export interface KimiCodeExtraUsage {
  balanceCents: number;
  currency: string;
  monthlyChargeLimitCents: number;
  monthlyChargeLimitEnabled: boolean;
  monthlyUsedCents: number;
  totalCents: number;
}

export type KimiCodeQuotaUnavailableReason = 'credentials-expired' | 'credentials-not-found';

export interface KimiCodeQuotaSnapshot {
  error: string | null;
  extraUsage: KimiCodeExtraUsage | null;
  identity?: QuotaAccountIdentity | null;
  /** `limit_month_total` (windowMinutes 43200). */
  monthly: HeteroQuotaWindow | null;
  /** `limit_month_code` (windowMinutes 43200). */
  monthlyCode: HeteroQuotaWindow | null;
  provider: 'kimi-code';
  readings?: QuotaLimitReading[];
  reason?: KimiCodeQuotaUnavailableReason;
  /** `limit_5h` (windowMinutes 300). */
  session: HeteroQuotaWindow | null;
  status: 'error' | 'ok' | 'unavailable';
  updatedAt: number;
  /** `limit_7d` (windowMinutes 10080). */
  weekly: HeteroQuotaWindow | null;
}
