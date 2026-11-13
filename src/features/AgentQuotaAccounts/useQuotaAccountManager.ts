import { isDesktop } from '@lobechat/const';
import { currentUtilization, isWeeklyAllLimit } from '@lobechat/heterogeneous-agents/quota';
import { isAuthorizedQuotaBinding } from '@lobechat/types';
import { toast } from '@lobehub/ui';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cacheScope } from '@/libs/replica';
import {
  agentQuotaSelectors,
  type QuotaAccount,
  type QuotaBinding,
  type QuotaLatestReading,
  useAgentQuotaStore,
} from '@/store/agentQuota';
import { useElectronStore } from '@/store/electron';
import { electronGatewaySelectors } from '@/store/electron/selectors';

type Account = QuotaAccount;
type Binding = QuotaBinding;
type QuotaReading = QuotaLatestReading;

const EMPTY_ACCOUNTS: Account[] = [];
const EMPTY_BINDINGS: Binding[] = [];

/** The load-balancing choice that routes each run to the account with the most headroom. */
export const AUTO = 'auto';

const clampPercent = (n: number) => Math.min(100, Math.max(0, Math.round(n)));

/**
 * Weekly headroom for the account row. A reading whose window already rolled
 * over describes spend that has since refilled, so it counts as free rather
 * than as the last utilization it happened to record.
 */
const weeklyLeftOf = (readings: QuotaReading[], now = Date.now()): number | undefined => {
  const weekly = readings.find((r) => isWeeklyAllLimit(r));
  return weekly ? clampPercent(100 - currentUtilization(weekly, now)) : undefined;
};

export const accountName = (a: Account) => a.label || a.email || a.externalAccountId;

export interface QuotaAccountManagerOptions {
  agentId: string;
  /**
   * Bound execution device the agent runs on. A remote device's logins live
   * on that machine, not on the desktop showing the page, so local sign-in
   * state says nothing about which accounts it can run there. The Manual pick
   * is made for this device (this desktop when unset).
   */
  deviceId?: string;
  /** Read-only view (the viewer may not edit this agent). */
  disabled?: boolean;
}

/** State and writes behind the load-balancing cards on the agent's `/accounts` page. */
export const useQuotaAccountManager = ({
  agentId,
  deviceId,
  disabled,
}: QuotaAccountManagerOptions) => {
  const { t } = useTranslation('chat');
  const [
    useFetchQuotaAccounts,
    useFetchQuotaBindings,
    useFetchQuotaDeviceAccount,
    bindQuotaAccount,
    renameQuotaAccount,
    setQuotaDeviceAccount,
    switchQuotaAccount,
    unbindQuotaAccount,
    useFetchClaudeLocalAccounts,
    loginClaudeAccount,
    cancelClaudeAccountLogin,
  ] = useAgentQuotaStore((s) => [
    s.useFetchQuotaAccounts,
    s.useFetchQuotaBindings,
    s.useFetchQuotaDeviceAccount,
    s.bindQuotaAccount,
    s.renameQuotaAccount,
    s.setQuotaDeviceAccount,
    s.switchQuotaAccount,
    s.unbindQuotaAccount,
    s.useFetchClaudeLocalAccounts,
    s.loginClaudeAccount,
    s.cancelClaudeAccountLogin,
  ]);
  const scope = cacheScope.use();
  const { error: accountsError } = useFetchQuotaAccounts();
  useFetchQuotaBindings(agentId);
  // Only the desktop runs Claude Code locally, so only it has logins to show —
  // and only when this agent runs here: in-process, or through the gateway on
  // this desktop's own device row, which spawns on the same logins.
  const [currentDeviceId, useFetchGatewayStableDeviceId] = useElectronStore((s) => [
    s.gatewayDeviceInfo?.deviceId,
    s.useFetchGatewayStableDeviceId,
  ]);
  // The cached id may still be the install's fallback before the gateway
  // connects; resolving corrects it, so the pick lands on this machine's row.
  // Until it settles a write could not tell this device from "no device" and
  // would fall back to the agent-wide pin, so the controls wait for it.
  const needsLocalDevice = isDesktop && !deviceId;
  useFetchGatewayStableDeviceId(needsLocalDevice);
  const stableDeviceId = useElectronStore(electronGatewaySelectors.gatewayStableDeviceId);
  // The replica entry is `undefined` until this device is resolved (or hydrated).
  const localDeviceSettled = !needsLocalDevice || stableDeviceId !== undefined;
  // Resolved to no id (the IPC lookup failed): this is still a desktop picking
  // for itself, not the web's agent-wide case, so it shows but cannot write.
  const localDeviceMissing = needsLocalDevice && stableDeviceId === null;
  const managesLocalLogins = isDesktop && (!deviceId || deviceId === currentDeviceId);
  // A login lives on one machine, so the Manual pick belongs to one device.
  // The web without a bound device has none and keeps the agent-wide pin.
  // Never the cached `gatewayDeviceInfo` id: before the gateway connects that
  // is the install's fallback UUID, not the row the server knows this machine by.
  const targetDeviceId = deviceId ?? (isDesktop ? (stableDeviceId ?? undefined) : undefined);
  useFetchQuotaDeviceAccount(agentId, targetDeviceId);
  const deviceAccount = useAgentQuotaStore(
    agentQuotaSelectors.deviceAccount(agentId, targetDeviceId),
  );
  const deviceAccountConfirmed = useAgentQuotaStore(
    agentQuotaSelectors.isDeviceAccountConfirmed(scope, agentId, targetDeviceId),
  );
  useFetchClaudeLocalAccounts(managesLocalLogins);
  const localAccounts = useAgentQuotaStore((s) => s.claudeLocalAccounts);
  const loginPending = useAgentQuotaStore((s) => s.claudeLoginPending);
  // A hydrated empty list may be an outdated snapshot: only the server's answer
  // (or a failed first read) settles "no accounts yet".
  const accountsConfirmed = useAgentQuotaStore(agentQuotaSelectors.isAccountsConfirmed(scope));
  // The replica paints the last-known pool on open; the server confirms behind it.
  const allAccounts = useAgentQuotaStore(agentQuotaSelectors.accounts) ?? EMPTY_ACCOUNTS;
  // The pool holds every coding agent's accounts; this manager (and the run
  // routing behind it) only speaks for Claude Code.
  const claudeAccounts = useMemo(
    () => allAccounts.filter((a) => a.provider === 'claude-code'),
    [allAccounts],
  );
  const loadedBindings = useAgentQuotaStore(agentQuotaSelectors.bindings(agentId));
  // Bindings are provider-blind; another coding agent's pin is not a Claude
  // choice (Claude routing skips it), so this manager neither shows nor
  // touches bindings of accounts it does not list.
  const bindings = useMemo(() => {
    const claudeIds = new Set(claudeAccounts.map((a) => a.id));
    return (loadedBindings ?? EMPTY_BINDINGS).filter((b) => claudeIds.has(b.accountId));
  }, [claudeAccounts, loadedBindings]);
  // Load balancing only ever picks among the accounts this agent is authorized
  // to schedule (Agent Profile → subscription accounts), never the global pool.
  const accounts = useMemo(() => {
    const authorized = new Set(
      bindings.filter((b) => isAuthorizedQuotaBinding(b)).map((b) => b.accountId),
    );
    return claudeAccounts.filter((a) => authorized.has(a.id));
  }, [bindings, claudeAccounts]);
  // Until this agent's bindings are on screen, every row would read as "off"
  // and Auto as routing to nobody: keep the mode and per-account controls
  // disabled and show no routing hint instead of acting on that guess.
  const bindingsLoaded =
    localDeviceSettled &&
    loadedBindings !== undefined &&
    (!targetDeviceId || deviceAccount !== undefined);
  // A hydrated row may be outdated (changed in another tab or on another
  // device): show it, but take writes only once the server confirmed it, so a
  // change is computed against the bindings the server actually holds.
  const bindingsConfirmed = useAgentQuotaStore(
    agentQuotaSelectors.isBindingsConfirmed(scope, agentId),
  );
  const canEditBindings =
    !disabled &&
    !localDeviceMissing &&
    bindingsLoaded &&
    bindingsConfirmed &&
    (!targetDeviceId || deviceAccountConfirmed);
  const readingsMap = useAgentQuotaStore((s) => s.quotaReadingsMap);
  const weeklyById = useMemo(
    () =>
      Object.fromEntries(
        accounts.map((a) => {
          const readings = readingsMap[a.id];
          return [a.id, readings ? weeklyLeftOf(readings) : undefined] as const;
        }),
      ) as Record<string, number | undefined>,
    [accounts, readingsMap],
  );
  const [busy, setBusy] = useState(false);
  // Staged account selection — applied only when the user confirms.
  const [pending, setPending] = useState<string | null>(null);
  // Inline rename state (no nested modal).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');

  const roleOf = useCallback(
    (accountId: string) => bindings.find((b) => b.accountId === accountId)?.role,
    [bindings],
  );
  const bindingOf = useCallback(
    (accountId: string) => bindings.find((b) => b.accountId === accountId),
    [bindings],
  );
  const inRotation = useCallback(
    (accountId: string) => {
      const r = roleOf(accountId);
      return r === 'pinned' || r === 'pool';
    },
    [roleOf],
  );

  /**
   * Whether a run on this desktop can use the account. Unknown (web, a bound
   * device, or the logins not listed yet) counts as yes, so nothing is gated
   * on a guess.
   */
  const signedInHere = useCallback(
    (account: Account) =>
      !managesLocalLogins ||
      !localAccounts ||
      localAccounts.some((l) => l.identity.externalAccountId === account.externalAccountId),
    [localAccounts, managesLocalLogins],
  );

  // A legacy agent-wide pin only counts here while this device can run it: a
  // pin picked on another machine leaves this one balancing (as runs do).
  const agentPinnedId = bindings.find((b) => b.role === 'pinned')?.accountId;
  const agentPinned = accounts.find((a) => a.id === agentPinnedId);
  const devicePinnedId = deviceAccount?.accountId ?? undefined;
  const pinnedId = targetDeviceId
    ? devicePinnedId && inRotation(devicePinnedId)
      ? devicePinnedId
      : agentPinned && signedInHere(agentPinned)
        ? agentPinned.id
        : undefined
    : agentPinnedId;
  const current = pinnedId ?? AUTO;
  // A staged account that left the authorized set (unchecked in the profile
  // meanwhile) is no longer a choice: drop it rather than re-authorize it.
  const stagedPick =
    pending === null || pending === AUTO || accounts.some((a) => a.id === pending) ? pending : null;
  const selected = stagedPick ?? current;
  const dirty = stagedPick !== null && stagedPick !== current;

  // Every write lands on the replica optimistically and re-reads its entry.
  const run = useCallback(async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  }, []);

  // Preview which account Auto would route to (most weekly headroom in the pool).
  const routeId = useMemo(() => {
    if (selected !== AUTO) return null;
    // Runtime routing only balances across logins this device holds.
    const pool = accounts.filter((a) => inRotation(a.id) && signedInHere(a));
    if (pool.length === 0) return null;
    return [...pool].sort((a, b) => (weeklyById[b.id] ?? 100) - (weeklyById[a.id] ?? 100))[0].id;
  }, [selected, accounts, inRotation, signedInHere, weeklyById]);
  const routeAccount = accounts.find((a) => a.id === routeId);

  const applySelection = useCallback(
    () =>
      run(async () => {
        const value = stagedPick;
        if (value === null) return;
        // Never turn this desktop's pick into an agent-wide one.
        if (needsLocalDevice && !targetDeviceId) return;
        if (targetDeviceId) {
          await setQuotaDeviceAccount(agentId, targetDeviceId, value === AUTO ? null : value);
        } else if (value === AUTO) {
          if (pinnedId) await bindQuotaAccount(agentId, pinnedId, 'pool');
        } else {
          await switchQuotaAccount(agentId, value);
        }
      })
        .then(() => setPending(null))
        .catch((error: { data?: { code?: string } }) => {
          toast.error(
            error?.data?.code === 'PRECONDITION_FAILED'
              ? t('heteroAgent.claudeQuota.manage.notSignedInOnDevice')
              : t('heteroAgent.claudeQuota.manage.switchFailed'),
          );
        }),
    [
      agentId,
      bindQuotaAccount,
      needsLocalDevice,
      pinnedId,
      run,
      setQuotaDeviceAccount,
      stagedPick,
      switchQuotaAccount,
      t,
      targetDeviceId,
    ],
  );

  const remove = useCallback(
    (accountId: string) => {
      // An unconfirmed (hydrated) binding id may already be gone on the server.
      const b = canEditBindings ? bindingOf(accountId) : undefined;
      if (!b) return;
      // Removing the account currently staged for switch cancels the stage.
      if (pending === accountId) setPending(null);
      return run(() => unbindQuotaAccount(agentId, b.id));
    },
    [agentId, bindingOf, canEditBindings, pending, run, unbindQuotaAccount],
  );

  const startEdit = useCallback((a: Account) => {
    setEditingId(a.id);
    setEditLabel(a.label ?? '');
  }, []);
  const saveEdit = useCallback(
    (accountId: string) =>
      run(() => renameQuotaAccount(accountId, editLabel.trim() || undefined)).then(() =>
        setEditingId(null),
      ),
    [editLabel, renameQuotaAccount, run],
  );

  // A cancelled sign-in rejects too, but is not a failure worth a toast.
  const loginCancelled = useRef(false);
  const signIn = useCallback(
    async (email?: string) => {
      loginCancelled.current = false;
      try {
        const local = await loginClaudeAccount(email);
        const account = agentQuotaSelectors
          .accounts(useAgentQuotaStore.getState())
          ?.find((a) => a.externalAccountId === local.identity.externalAccountId);
        // A new login joins this agent's rotation, ready to be picked.
        if (account && !bindingOf(account.id))
          await bindQuotaAccount(agentId, account.id, 'pool').catch(() => {});
        toast.success(
          t('heteroAgent.claudeQuota.manage.loginSuccess', {
            account: local.identity.email || local.identity.externalAccountId,
          }),
        );
      } catch {
        if (!loginCancelled.current) toast.error(t('heteroAgent.claudeQuota.manage.loginFailed'));
      }
    },
    [agentId, bindQuotaAccount, bindingOf, loginClaudeAccount, t],
  );
  const cancelSignIn = useCallback(() => {
    loginCancelled.current = true;
    void cancelClaudeAccountLogin();
  }, [cancelClaudeAccountLogin]);

  return {
    accounts,
    accountsConfirmed,
    accountsError,
    applySelection,
    bindingOf,
    bindingsLoaded,
    busy,
    canEditBindings,
    cancelSignIn,
    claudeAccounts,
    dirty,
    editLabel,
    editingId,
    inRotation,
    loginPending,
    managesLocalLogins,
    readingsMap,
    remove,
    routeAccount,
    saveEdit,
    selected,
    setEditLabel,
    setEditingId,
    setPending,
    signIn,
    signedInHere,
    startEdit,
    weeklyById,
  };
};
