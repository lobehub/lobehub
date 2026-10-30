import type { QuotaLimitReading } from '@lobechat/heterogeneous-agents/quota';
import { useMemo } from 'react';

import { cacheScope } from '@/libs/replica';
import { agentQuotaSelectors, type QuotaWindowRow, useAgentQuotaStore } from '@/store/agentQuota';

import { selectProviderQuotaAccount, type UsageTurn } from './quotaCalendarModel';

const EMPTY_READINGS: QuotaLimitReading[] = [];
const EMPTY_TURNS: UsageTurn[] = [];
const EMPTY_WINDOW_ROWS: QuotaWindowRow[] = [];

export interface QuotaCalendarHistory {
  /** The server (or a failed first read) says the provider has no such account. */
  accountUnavailable: boolean;
  /** Nothing to draw yet: no account resolved, or no history the server has settled. */
  loading: boolean;
  readings: QuotaLimitReading[];
  turns: UsageTurn[];
  windowRows: QuotaWindowRow[];
}

/**
 * The calendar's account and 90-day history, read from the agentQuota
 * replicas: a reopen (or a reload) paints the last-seen history at once and
 * revalidates it in the background.
 */
export const useQuotaCalendarHistory = (
  provider: string,
  externalAccountId?: string,
): QuotaCalendarHistory => {
  const scope = cacheScope.use();
  const [useFetchQuotaAccounts, useFetchQuotaHistory] = useAgentQuotaStore((s) => [
    s.useFetchQuotaAccounts,
    s.useFetchQuotaHistory,
  ]);
  const { error: accountsError } = useFetchQuotaAccounts();
  const accounts = useAgentQuotaStore(agentQuotaSelectors.accounts);
  const accountsConfirmed = useAgentQuotaStore(agentQuotaSelectors.isAccountsConfirmed(scope));
  const account = useMemo(
    () =>
      accounts ? selectProviderQuotaAccount(accounts, provider, externalAccountId) : undefined,
    [accounts, externalAccountId, provider],
  );
  const { error: historyError } = useFetchQuotaHistory(account?.id);
  const history = useAgentQuotaStore(agentQuotaSelectors.history(account?.id));
  const historyConfirmed = useAgentQuotaStore(
    agentQuotaSelectors.isHistoryConfirmed(scope, account?.id),
  );

  // A hydrated account list may predate the account, so "no account" waits for
  // the server (or a failed first read, which the old fetch also showed as none).
  const accountUnavailable = !account && (accountsConfirmed || !!accountsError);
  const readings = (history?.snapshots as QuotaLimitReading[] | undefined) ?? EMPTY_READINGS;
  const turns = (history?.usageTurns as UsageTurn[] | undefined) ?? EMPTY_TURNS;
  const windowRows = history?.windows ?? EMPTY_WINDOW_ROWS;
  const hasHistoryData = readings.length > 0 || windowRows.length > 0;
  // An empty local copy is not an answer yet: keep the skeleton until the
  // server (or a failure) settles it.
  const loading =
    !accountUnavailable && (!account || (!hasHistoryData && !historyConfirmed && !historyError));

  return { accountUnavailable, loading, readings, turns, windowRows };
};
