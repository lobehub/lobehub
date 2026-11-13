import type { QuotaAccountProvider } from '@lobechat/types';
import isEqual from 'fast-deep-equal';
import { useCallback, useMemo, useState } from 'react';

import { cacheScope } from '@/libs/replica';
import { agentQuotaSelectors, type QuotaAccount, useAgentQuotaStore } from '@/store/agentQuota';

const EMPTY: QuotaAccount[] = [];

/** The authorized set after adding and removing accounts, in pool order; ids gone from the pool drop out. */
export const nextAuthorizedAccountIds = (
  pool: Pick<QuotaAccount, 'id'>[],
  authorized: ReadonlySet<string>,
  { add = [], remove = [] }: { add?: string[]; remove?: string[] },
): string[] =>
  pool
    .map((a) => a.id)
    .filter((id) => !remove.includes(id) && (authorized.has(id) || add.includes(id)));

/**
 * One agent's view of the global subscription account pool: every account of
 * `provider`, which of them the agent is authorized to schedule (`linked`) and
 * which it is not yet (`unlinked`), plus `add` / `remove`, which rewrite the
 * agent's authorized set. Many agents may authorize the same account; a write
 * here never touches another agent's set.
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
  const write = useCallback(
    async (change: { add?: string[]; remove?: string[] }): Promise<boolean> => {
      setSaving(true);
      try {
        await setQuotaAgentAccounts(
          agentId,
          nextAuthorizedAccountIds(accounts, authorized, change),
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
  const add = useCallback((accountIds: string[]) => write({ add: accountIds }), [write]);
  const remove = useCallback((accountId: string) => write({ remove: [accountId] }), [write]);

  const linked = useMemo(
    () => accounts.filter((a) => authorized.has(a.id)),
    [accounts, authorized],
  );
  const unlinked = useMemo(
    () => accounts.filter((a) => !authorized.has(a.id)),
    [accounts, authorized],
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
    add,
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
    linked,
    remove,
    retry,
    unlinked,
  };
};
