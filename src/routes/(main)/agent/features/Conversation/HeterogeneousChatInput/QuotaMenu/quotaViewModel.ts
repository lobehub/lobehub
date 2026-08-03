import type {
  ClaudeCodeAccountIdentity,
  ClaudeCodeQuotaSnapshot,
} from '@lobechat/electron-client-ipc';
import type { QuotaDisplayReading } from '@lobechat/heterogeneous-agents/quota';
import { buildClaudeQuotaWindows } from '@lobechat/heterogeneous-agents/quota';

/**
 * Minimal shape of a persisted quota reading as returned by
 * `agentQuota.getLatestReadings` — one row per (limitType, scopeKey), already
 * flattened to epoch ms by the server.
 */
export type QuotaReadingRow = QuotaDisplayReading;

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

const identityOf = (account: QuotaAccountRow): ClaudeCodeAccountIdentity => ({
  displayName: account.displayName ?? undefined,
  email: account.email ?? undefined,
  externalAccountId: account.externalAccountId ?? undefined,
  organizationId: account.organizationId ?? undefined,
  planTier: account.planTier ?? undefined,
  rateLimitTier: account.rateLimitTier ?? undefined,
});

/**
 * Build the panel snapshot from the persisted readings — the primary display
 * source. The live Anthropic fetch is only used to refresh/ingest these rows,
 * so the panel keeps showing data even when that fetch fails.
 *
 * Readings rather than `agent_quota_windows`: a window is keyed by its
 * `resets_at`, so a limit the provider reports without one (an untouched
 * model-scoped weekly) has no window row at all, and a window whose reset has
 * passed is not the live one. {@link buildClaudeQuotaWindows} covers both — a
 * rolled-over window renders as refilled instead of vanishing from the panel.
 */
export const buildClaudeSnapshotFromReadings = (
  account: QuotaAccountRow,
  readings: QuotaReadingRow[],
  now: number = Date.now(),
): ClaudeCodeQuotaSnapshot => {
  const windows = buildClaudeQuotaWindows(readings, now);

  // Freshness is based on when our server received the snapshot, not on the
  // sampling device's wall clock. Device timestamps remain on the readings for
  // history and cached-echo detection, but clock skew must not suppress or
  // accelerate browser refreshes.
  const updatedAt = toMs(account.updatedAt) ?? 0;

  return {
    error: null,
    identity: identityOf(account),
    provider: 'claude-code',
    scopedWeekly: windows.scopedWeekly,
    session: windows.session,
    status: 'ok',
    updatedAt: updatedAt || now,
    weekly: windows.weekly,
  };
};

/**
 * Newest persisted reading time (0 when none). Readings carry the sampling
 * host's `capturedAt`, so this compares 1:1 against a live snapshot's readings
 * — both are stamped by the same host.
 */
export const newestCapturedAt = (readings: QuotaReadingRow[]): number =>
  readings.reduce((max, r) => Math.max(max, r.capturedAt), 0);

/**
 * Merge the persisted view with a live sample, window by window.
 *
 * Whole-snapshot "persisted wins" loses real data: a window the DB has no
 * reading for (ingest failed, identity unresolvable, a limit this account has
 * no history for) would render as "this plan has no such limit" even though the
 * sample in hand has it. Which side leads is a freshness question —
 * `persistedAsOf` is the newest persisted reading time, comparable with the
 * live snapshot's stamp because both come from the sampler host — and the other
 * side fills whatever the leader is missing.
 */
export const mergeClaudeSnapshots = (
  persisted: ClaudeCodeQuotaSnapshot | null,
  live: ClaudeCodeQuotaSnapshot | null,
  persistedAsOf = 0,
): ClaudeCodeQuotaSnapshot | null => {
  if (!persisted) return live;
  if (!live || live.status !== 'ok') return persisted;

  // A sample taken from another login says nothing about the account on screen.
  const persistedAccountId = persisted.identity?.externalAccountId;
  const liveAccountId = live.identity?.externalAccountId;
  if (persistedAccountId && liveAccountId && persistedAccountId !== liveAccountId) return persisted;

  const preferLive = live.updatedAt >= persistedAsOf;
  const pick = <T>(fromPersisted: T | null, fromLive: T | null): T | null =>
    preferLive ? (fromLive ?? fromPersisted) : (fromPersisted ?? fromLive);

  return {
    ...persisted,
    scopedWeekly: pick(persisted.scopedWeekly, live.scopedWeekly),
    session: pick(persisted.session, live.session),
    weekly: pick(persisted.weekly, live.weekly),
  };
};

/**
 * Whether a built snapshot carries at least one window worth rendering.
 * Callers cannot infer this from the persisted row count: an account may hold
 * readings only for limits the panel does not render, which
 * {@link buildClaudeSnapshotFromReadings} maps to nothing. Treating a non-empty
 * row array as "we have data" would discard a live sample in favour of an
 * empty panel.
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
