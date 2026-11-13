import type { QuotaAccountProvider } from '@lobechat/types';
import isEqual from 'fast-deep-equal';
import { useCallback, useMemo, useState } from 'react';

import { cacheScope } from '@/libs/replica';
import { agentQuotaSelectors, type QuotaAccount, useAgentQuotaStore } from '@/store/agentQuota';

const EMPTY: QuotaAccount[] = [];

/** The authorized set after one account is checked or unchecked, in pool order. */
export const nextAuthorizedAccountIds = (
  pool: Pick<QuotaAccount, 'id'>[],
  authorized: ReadonlySet<string>,
  accountId: string,
  checked: boolean,
): string[] =>
  pool.map((a) => a.id).filter((id) => (id === accountId ? checked : authorized.has(id)));

/**
 * One agent's view of the global subscription account pool: every account of
 * `provider`, which of them the agent is authorized to schedule, and a toggle
 * that rewrites the agent's authorized set. Many agents may authorize the same
 * account; a toggle here never touches another agent's set.
 */
export const useAgentAuthorizedAccounts = (
  agentId: string,
  provider: QuotaAccountProvider = 'claude-code',
) => {
  const [useFetchQuotaAccounts, useFetchQuotaBindings, setQuotaAgentAccounts] = useAgentQuotaStore(
    (s) => [s.useFetchQuotaAccounts, s.useFetchQuotaBindings, s.setQuotaAgentAccounts],
  );
  const scope = cacheScope.use();
  const accountsSync = useFetchQuotaAccounts();
  const bindingsSync = useFetchQuotaBindings(agentId);
  const accountsError = accountsSync.error;

  const loadedAccounts = useAgentQuotaStore(agentQuotaSelectors.accounts);
  const allAccounts = loadedAccounts ?? EMPTY;
  const accounts = useMemo(
    () => allAccounts.filter((a) => a.provider === provider),
    [allAccounts, provider],
  );
  const authorizedIds = useAgentQuotaStore(
    agentQuotaSelectors.authorizedAccountIds(agentId, provider),
    isEqual,
  );
  const authorized = useMemo(() => new Set(authorizedIds ?? []), [authorizedIds]);
  const accountsConfirmed = useAgentQuotaStore(agentQuotaSelectors.isAccountsConfirmed(scope));
  const bindingsConfirmed = useAgentQuotaStore(
    agentQuotaSelectors.isBindingsConfirmed(scope, agentId),
  );
  const [saving, setSaving] = useState(false);

  /** Rewrites the whole set; resolves false when the server refused it. */
  const toggle = useCallback(
    async (accountId: string, checked: boolean): Promise<boolean> => {
      setSaving(true);
      try {
        await setQuotaAgentAccounts(
          agentId,
          nextAuthorizedAccountIds(accounts, authorized, accountId, checked),
          provider,
        );
        return true;
      } catch {
        return false;
      } finally {
        setSaving(false);
      }
    },
    [accounts, agentId, authorized, provider, setQuotaAgentAccounts],
  );

  // A list the server has not confirmed is not a fact: a failed read (first
  // load, or a refresh behind hydrated data) shows an error and Retry instead
  // of an empty pool, nothing selected, or checkboxes disabled for good.
  const loadFailed =
    (!!bindingsSync.error && !bindingsConfirmed) || (!!accountsError && !accountsConfirmed);
  const retry = useCallback(
    () => Promise.all([accountsSync.revalidate(), bindingsSync.revalidate()]),
    [accountsSync.revalidate, bindingsSync.revalidate],
  );

  return {
    accounts,
    authorized,
    // Writes replace the whole set, so they wait until the server confirmed
    // both lists — a hydrated snapshot could silently drop an account.
    canEdit: accountsConfirmed && bindingsConfirmed && !saving,
    loadFailed,
    loaded:
      !loadFailed &&
      authorizedIds !== undefined &&
      loadedAccounts !== undefined &&
      (accountsConfirmed || !!accountsError),
    retry,
    toggle,
  };
};
