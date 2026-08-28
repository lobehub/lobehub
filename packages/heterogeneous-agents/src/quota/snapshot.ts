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
