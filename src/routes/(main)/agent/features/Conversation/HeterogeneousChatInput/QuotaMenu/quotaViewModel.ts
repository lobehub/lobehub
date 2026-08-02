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
  updatedAt?: Date | string | null;
}

const toMs = (v: Date | string | null | undefined): number | null => {
  if (v == null) return null;
  const ms = v instanceof Date ? v.getTime() : Date.parse(v);
  return Number.isNaN(ms) ? null : ms;
};

const toWindow = (row: QuotaWindowRow | undefined, now: number): HeteroQuotaWindow | null => {
  if (!row) return null;
  // A window whose reset has already passed says nothing about current usage —
  // the quota refilled at `resetsAt`. Showing its last utilization paints a
  // spent window as if it were live (an exhausted 0%-left badge on a fresh
  // quota), so drop it and let the caller fall back to a live sample.
  const resetsAt = toMs(row.resetsAt);
  if (resetsAt !== null && resetsAt <= now) return null;

  // Displayed "used" is the latest reading; peak is the monotonic ceiling fallback.
  const usedPercent = Math.max(0, Math.min(100, row.lastUtilization ?? row.peakUtilization ?? 0));
  return {
    resetsAt,
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
  now: number = Date.now(),
): ClaudeCodeQuotaSnapshot => {
  const session = windows.find((w) => w.limitType === 'session');
  const weekly = windows.find(isWeeklyAll);
  const scoped = windows.find((w) => w.limitType === 'weekly_scoped' && !!w.scopeKey);
  const scopedWindow = toWindow(scoped, now);

  // Freshness is based on when our server received the snapshot, not on the
  // sampling device's wall clock. Device timestamps remain on the windows for
  // history and cached-echo detection, but clock skew must not suppress or
  // accelerate browser refreshes.
  const updatedAt = toMs(account.updatedAt) ?? 0;

  return {
    error: null,
    identity: identityOf(account),
    provider: 'claude-code',
    scopedWeekly:
      scoped && scopedWindow ? { modelName: scoped.scopeKey, window: scopedWindow } : null,
    session: toWindow(session, now),
    status: 'ok',
    updatedAt: updatedAt || now,
    weekly: toWindow(weekly, now),
  };
};

/**
 * Newest persisted reading time across the windows (0 when none). `lastSeenAt`
 * is written from the readings' `capturedAt`, so this compares 1:1 against a
 * live snapshot's `capturedAt` values — both stamped by the desktop main
 * process.
 */
export const newestSeenAt = (windows: QuotaWindowRow[]): number =>
  windows.reduce((max, w) => Math.max(max, toMs(w.lastSeenAt) ?? 0), 0);

/**
 * Whether a built snapshot carries at least one window worth rendering. Callers
 * cannot infer this from the persisted row count: every row may describe a
 * window that has already reset, which {@link buildClaudeSnapshotFromWindows}
 * drops. Treating a non-empty row array as "we have data" would discard a live
 * sample in favour of an empty panel.
 */
export const hasRenderableWindow = (snapshot: ClaudeCodeQuotaSnapshot): boolean =>
  !!snapshot.session || !!snapshot.weekly || !!snapshot.scopedWeekly;

/** Whether the server receipt time is older than `maxAgeMs`. */
export const isQuotaStale = (
  receivedAt: Date | string | null | undefined,
  now: number,
  maxAgeMs: number,
): boolean => {
  const receivedAtMs = toMs(receivedAt);
  return receivedAtMs === null || now - receivedAtMs > maxAgeMs;
};
