import {
  isSessionLimit,
  isWeeklyAllLimit,
  type QuotaDisplayReading,
  toQuotaWindow,
} from '@lobechat/heterogeneous-agents/quota';

export type SubscriptionProvider = 'claude-code' | 'codex' | 'kimi-code';

export const SUBSCRIPTION_PROVIDERS: SubscriptionProvider[] = ['claude-code', 'codex', 'kimi-code'];

export const isSubscriptionProvider = (provider: string): provider is SubscriptionProvider =>
  (SUBSCRIPTION_PROVIDERS as string[]).includes(provider);

/** A limit is used up at this utilization — the load balancer's own threshold. */
const EXHAUSTED_PERCENT = 100;

export interface AccountWindowView {
  /** Window boundary of the live window; null once it rolled over or when unreported. */
  resetsAt: number | null;
  usedPercent: number;
}

export type AccountStatus = 'available' | 'disabled' | 'exhausted' | 'noData';

export interface AccountView {
  /** Newest reading time, so the card can say how fresh its numbers are. */
  lastSyncedAt?: number;
  /** When an exhausted account gets capacity back: the latest reset among its used-up windows. */
  recoversAt?: number;
  session?: AccountWindowView;
  status: AccountStatus;
  weekly?: AccountWindowView;
}

const newest = <T extends QuotaDisplayReading>(
  readings: T[],
  match: (reading: T) => boolean,
): T | undefined =>
  readings.reduce<T | undefined>(
    (found, reading) =>
      match(reading) && (!found || reading.capturedAt > found.capturedAt) ? reading : found,
    undefined,
  );

const windowOf = (reading: QuotaDisplayReading | undefined, now: number) => {
  if (!reading) return undefined;
  const window = toQuotaWindow(reading, now);
  return { resetsAt: window.resetsAt, usedPercent: window.usedPercent };
};

/**
 * One account card's state from its newest per-bucket readings. A window that
 * already rolled over reads as refilled, the same rule the chat quota panel and
 * the load balancer apply, so the card never paints an exhausted meter over a
 * quota that is free again.
 */
export const deriveAccountView = (
  account: { enabled?: boolean | null },
  readings: QuotaDisplayReading[] | undefined,
  now: number,
): AccountView => {
  const list = readings ?? [];
  const sessionReading = newest(list, isSessionLimit);
  const weeklyReading = newest(list, isWeeklyAllLimit);
  const session = windowOf(sessionReading, now);
  const weekly = windowOf(weeklyReading, now);
  const lastSyncedAt = list.length
    ? list.reduce((max, reading) => Math.max(max, reading.capturedAt), 0)
    : undefined;

  // A rolled-over window already reads 0% here, so only a live window can be used up.
  const exhausted = [session, weekly].filter(
    (window): window is AccountWindowView => !!window && window.usedPercent >= EXHAUSTED_PERCENT,
  );

  const base = { lastSyncedAt, session, weekly };

  if (account.enabled === false) return { ...base, status: 'disabled' };
  if (exhausted.length > 0) {
    const resets = exhausted
      .map((window) => window.resetsAt)
      .filter((value): value is number => value != null);
    return {
      ...base,
      recoversAt: resets.length ? Math.max(...resets) : undefined,
      status: 'exhausted',
    };
  }
  if (!session && !weekly) return { ...base, status: 'noData' };
  return { ...base, status: 'available' };
};

const PROVIDER_ORDER: Record<string, number> = { 'claude-code': 0, 'codex': 1, 'kimi-code': 2 };

/** Accounts in rotation first, then grouped by provider, then by name. */
export const sortAccounts = <
  T extends {
    email?: string | null;
    enabled?: boolean | null;
    label?: string | null;
    provider: string;
  },
>(
  accounts: T[],
): T[] =>
  [...accounts].sort(
    (a, b) =>
      Number(b.enabled !== false) - Number(a.enabled !== false) ||
      (PROVIDER_ORDER[a.provider] ?? 99) - (PROVIDER_ORDER[b.provider] ?? 99) ||
      (a.label || a.email || '').localeCompare(b.label || b.email || ''),
  );

/** Whether an account matches the search box: name, email or plan, case-insensitive. */
export const matchesKeyword = (
  account: { email?: string | null; label?: string | null; planTier?: string | null },
  keyword: string,
): boolean => {
  const needle = keyword.trim().toLowerCase();
  if (!needle) return true;
  return [account.label, account.email, account.planTier].some((field) =>
    field?.toLowerCase().includes(needle),
  );
};
