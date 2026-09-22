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
 * Newest persisted reading time (0 when none). Readings carry the sampling
 * host's `capturedAt`, so this compares 1:1 against a live snapshot's readings
 * — both are stamped by the same host.
 */
export const newestCapturedAt = (readings: QuotaReadingRow[]): number =>
  readings.reduce((max, r) => Math.max(max, r.capturedAt), 0);

/**
 * Whether a live sample provably describes the account on screen.
 *
 * Requiring a positive match (rather than only rejecting a mismatch) is what
 * keeps an *unidentifiable* sample off a named account: `~/.claude.json` may
 * carry no `oauthAccount` while the quota itself comes from the keychain, and
 * with several logins on the machine the CLI's current one is not necessarily
 * the account this panel is showing. Painting one account's numbers under
 * another's name is worse than leaving a window unfilled. An account we cannot
 * name either has nothing to be confused with, so it accepts any sample.
 */
const liveBelongsToAccount = (account: QuotaAccountRow, live: ClaudeCodeQuotaSnapshot): boolean => {
  const accountId = account.externalAccountId;
  if (!accountId) return true;
  return live.identity?.externalAccountId === accountId;
};

/**
 * The snapshot the panel renders: persisted readings, with an attributable live
 * sample folded in. Pass `live = null` for the persisted-only view (the interim
 * paint before a live refresh resolves).
 *
 * Readings rather than `agent_quota_windows`: a window is keyed by its
 * `resets_at`, so a limit the provider reports without one (an untouched
 * model-scoped weekly) has no window row at all, and a window whose reset has
 * passed is not the live one. {@link buildClaudeQuotaWindows} covers both — a
 * rolled-over window renders as refilled instead of vanishing from the panel.
 *
 * The merge happens at the *reading* level, so freshness is decided per limit —
 * {@link buildClaudeQuotaWindows} keeps the newest reading in each bucket. A
 * snapshot-level comparison would let one fresh bucket suppress newer live data
 * for every other bucket (a session sampled at 12:00 discarding an 11:00 weekly
 * that is newer than the persisted 10:00 one).
 *
 * A sample that carries windows but no readings (an older sampler build behind
 * the device RPC) can still fill a limit the account has no reading for at all
 * — otherwise the panel renders "this plan has no such limit" while holding a
 * sample that has it.
 */
export const buildClaudePanelSnapshot = (
  account: QuotaAccountRow,
  persistedReadings: QuotaReadingRow[],
  live: ClaudeCodeQuotaSnapshot | null,
  now: number = Date.now(),
): ClaudeCodeQuotaSnapshot => {
  const sample = live?.status === 'ok' && liveBelongsToAccount(account, live) ? live : null;
  const readings = sample?.readings?.length
    ? [...persistedReadings, ...sample.readings]
    : persistedReadings;
  const windows = buildClaudeQuotaWindows(readings, now);

  // Freshness is normally the server's receipt time — a device clock must not
  // drive the refresh gates. But once a live sample has been consulted, the
  // panel is at least as current as that sample, and reporting the older
  // receipt would both mislabel the header and re-trip every staleness gate
  // into refetching a quota we just fetched.
  const receivedAt = toMs(account.updatedAt) ?? 0;
  const updatedAt = sample ? Math.max(receivedAt, sample.updatedAt) : receivedAt;

  return {
    error: null,
    identity: identityOf(account),
    provider: 'claude-code',
    scopedWeekly: windows.scopedWeekly ?? sample?.scopedWeekly ?? null,
    session: windows.session ?? sample?.session ?? null,
    status: 'ok',
    updatedAt: updatedAt || now,
    weekly: windows.weekly ?? sample?.weekly ?? null,
  };
};

/**
 * Whether a built snapshot carries at least one window worth rendering.
 * Callers cannot infer this from the persisted row count: an account may hold
 * readings only for limits the panel does not render, which
 * {@link buildClaudePanelSnapshot} maps to nothing. Treating a non-empty row
 * array as "we have data" would discard a live sample in favour of an empty
 * panel.
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
