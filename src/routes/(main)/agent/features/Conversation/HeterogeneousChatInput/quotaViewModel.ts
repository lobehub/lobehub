import type {
  ClaudeCodeAccountIdentity,
  ClaudeCodeQuotaSnapshot,
  HeteroQuotaWindow,
} from '@lobechat/electron-client-ipc';

/**
 * Minimal shape of a persisted `agent_quota_windows` row as returned by
 * `agentQuota.getWindows` (dates arrive as `Date` via the superjson transformer,
 * but we tolerate strings too).
 */
export interface QuotaWindowRow {
  lastSeenAt?: Date | string | null;
  lastUtilization?: number | null;
  limitType: string;
  peakUtilization: number;
  resetsAt?: Date | string | null;
  scopeKey: string;
  windowSeconds: number;
}

export interface QuotaAccountRow {
  displayName?: string | null;
  email?: string | null;
  externalAccountId?: string | null;
  organizationId?: string | null;
  planTier?: string | null;
  rateLimitTier?: string | null;
}

const toMs = (v: Date | string | null | undefined): number | null => {
  if (v == null) return null;
  const ms = v instanceof Date ? v.getTime() : Date.parse(v);
  return Number.isNaN(ms) ? null : ms;
};

const toWindow = (row: QuotaWindowRow | undefined): HeteroQuotaWindow | null => {
  if (!row) return null;
  // Displayed "used" is the latest reading; peak is the monotonic ceiling fallback.
  const usedPercent = Math.max(0, Math.min(100, row.lastUtilization ?? row.peakUtilization ?? 0));
  return {
    resetsAt: toMs(row.resetsAt),
    usedPercent,
    windowMinutes: Math.round((row.windowSeconds ?? 0) / 60),
  };
};

const isWeeklyAll = (row: QuotaWindowRow): boolean =>
  row.limitType === 'weekly_all' || (row.limitType.startsWith('weekly') && !row.scopeKey);

const identityOf = (account: QuotaAccountRow): ClaudeCodeAccountIdentity => ({
  displayName: account.displayName ?? undefined,
  email: account.email ?? undefined,
  externalAccountId: account.externalAccountId ?? undefined,
  organizationId: account.organizationId ?? undefined,
  planTier: account.planTier ?? undefined,
  rateLimitTier: account.rateLimitTier ?? undefined,
});

/**
 * Build the panel snapshot from the persisted DB windows — the primary display
 * source. The live Anthropic fetch is only used to refresh/ingest these rows, so
 * the panel keeps showing data even when that fetch fails.
 */
export const buildClaudeSnapshotFromWindows = (
  account: QuotaAccountRow,
  windows: QuotaWindowRow[],
): ClaudeCodeQuotaSnapshot => {
  const session = windows.find((w) => w.limitType === 'session');
  const weekly = windows.find(isWeeklyAll);
  const scoped = windows.find((w) => w.limitType === 'weekly_scoped' && !!w.scopeKey);

  const updatedAt = windows.reduce((max, w) => Math.max(max, toMs(w.lastSeenAt) ?? 0), 0);

  return {
    error: null,
    identity: identityOf(account),
    provider: 'claude-code',
    scopedWeekly: scoped ? { modelName: scoped.scopeKey, window: toWindow(scoped)! } : null,
    session: toWindow(session),
    status: 'ok',
    updatedAt: updatedAt || Date.now(),
    weekly: toWindow(weekly),
  };
};

/** Whether the newest persisted reading is older than `maxAgeMs`. */
export const isQuotaStale = (windows: QuotaWindowRow[], now: number, maxAgeMs: number): boolean => {
  if (windows.length === 0) return true;
  const newest = windows.reduce((max, w) => Math.max(max, toMs(w.lastSeenAt) ?? 0), 0);
  return newest === 0 || now - newest > maxAgeMs;
};
