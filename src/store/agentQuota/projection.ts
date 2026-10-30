import type { QuotaLimitReading } from '@lobechat/heterogeneous-agents/quota';

import { defineReplica } from '@/libs/replica';
import type { agentQuotaService } from '@/services/agentQuota';

export type QuotaAccount = Awaited<ReturnType<typeof agentQuotaService.listAccounts>>[number];
export type QuotaBinding = Awaited<ReturnType<typeof agentQuotaService.listBindings>>[number];
export type QuotaLatestReading = Awaited<
  ReturnType<typeof agentQuotaService.getLatestReadings>
>[number];
export type QuotaWindowRow = Awaited<ReturnType<typeof agentQuotaService.getWindows>>[number];
export type QuotaUsageTurn = Awaited<ReturnType<typeof agentQuotaService.listUsageTurns>>[number];

/** The calendar reads 90 days of history: complete data for this month and the last. */
export const QUOTA_HISTORY_DAYS = 90;
/** Concrete windows the calendar asks for, newest reset first. */
export const QUOTA_HISTORY_WINDOW_LIMIT = 200;

/** One account's calendar history: windows, the reading series and per-turn spend. */
export interface QuotaHistory {
  snapshots: QuotaLimitReading[];
  usageTurns: QuotaUsageTurn[];
  windows: QuotaWindowRow[];
}

/** A history read: a part whose request failed is `undefined`. */
export type QuotaHistoryFetched = { [K in keyof QuotaHistory]: QuotaHistory[K] | undefined };

/**
 * The account list is one entry for the whole scope: every panel, the account
 * manager and the calendar resolve their account from it.
 */
export const QUOTA_ACCOUNTS_KEY = 'all';

/**
 * Persist the account rows without credential references. The server already
 * strips the encrypted credentials; the reference (keychain / file pointer)
 * and token expiry only matter to the server-side refresh worker.
 */
export const toPersistedQuotaAccounts = (accounts: QuotaAccount[]): QuotaAccount[] =>
  accounts.map((account) => {
    const lean = { ...account } as Partial<QuotaAccount>;
    delete lean.credentialRef;
    delete lean.credentialMode;
    delete lean.tokenExpiresAt;
    return lean as QuotaAccount;
  });

export const quotaAccountsResource = defineReplica<string, QuotaAccount[]>({
  key: (key) => key,
  name: 'agentQuotaAccounts',
  storage: 'indexedDB',
  version: 1,
});

/** One agent's account bindings (pinned / pool / disabled), keyed by agent id. */
export const quotaBindingsResource = defineReplica<string, QuotaBinding[]>({
  key: (agentId) => agentId,
  name: 'agentQuotaBindings',
  persist: { maxEntries: 50 },
  storage: 'indexedDB',
  version: 1,
});

/** The newest reading per limit bucket of one account, keyed by account id. */
export const quotaReadingsResource = defineReplica<string, QuotaLatestReading[]>({
  key: (accountId) => accountId,
  name: 'agentQuotaReadings',
  persist: { maxEntries: 30 },
  storage: 'indexedDB',
  version: 1,
});

/**
 * One account's 90-day calendar history. The reading series is the heaviest
 * payload of the domain, so only the most recently opened accounts persist.
 */
export const quotaHistoryResource = defineReplica<string, QuotaHistory, QuotaHistoryFetched>({
  key: (accountId) => accountId,
  name: 'agentQuotaHistory',
  persist: { maxEntries: 5 },
  storage: 'indexedDB',
  version: 1,
});

/** What every quota panel snapshot shares (see `QuotaMenu`). */
export interface QuotaPanelSnapshot {
  error: string | null;
  status: 'error' | 'ok' | 'unavailable';
  updatedAt: number;
}

/**
 * The last snapshot a quota panel rendered for one source (provider, agent,
 * device / local login, command and environment), so a reload paints the
 * badge and its "updated N ago" line before the live sampler answers.
 *
 * Fed by the panel's own sampler (desktop IPC / device RPC + persisted DB
 * readings), not by a fetcher: the replica only hydrates and persists.
 */
export const quotaPanelResource = defineReplica<string, QuotaPanelSnapshot>({
  key: (sourceKey) => sourceKey,
  name: 'agentQuotaPanel',
  persist: { maxEntries: 20 },
  storage: 'indexedDB',
  version: 1,
});

/**
 * Only a successful snapshot is worth replaying after a reload. An error or
 * an unavailable login is a current fact the sampler must confirm again, and
 * a "could not refresh" notice belongs to the session that saw it.
 */
export const toPersistedQuotaPanel = (snapshot: QuotaPanelSnapshot): QuotaPanelSnapshot | null => {
  if (snapshot.status !== 'ok') return null;
  if (!('refreshUnavailableReason' in snapshot)) return snapshot;

  const lean = { ...snapshot } as QuotaPanelSnapshot & { refreshUnavailableReason?: unknown };
  delete lean.refreshUnavailableReason;
  return lean;
};

/**
 * FNV-1a over the source description. A source key may carry the agent's
 * environment (API keys included), so only this digest reaches storage.
 */
export const hashQuotaSourceKey = (source: string): string => {
  let h1 = 0x81_1c_9d_c5;
  let h2 = 0x01_00_01_93;
  for (let index = 0; index < source.length; index++) {
    const code = source.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 0x01_00_01_93);
    h2 = Math.imul(h2 ^ code, 0x05_bd_1e_95);
  }
  return `${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`;
};
