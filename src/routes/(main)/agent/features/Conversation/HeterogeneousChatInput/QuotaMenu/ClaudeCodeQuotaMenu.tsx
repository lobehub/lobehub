'use client';

import type { ClaudeCodeQuotaSnapshot } from '@lobechat/electron-client-ipc';
import { memo, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentId } from '@/features/ChatInput/hooks/useAgentId';
import { agentQuotaService } from '@/services/agentQuota';
import { fetchClaudeCodeQuotaSnapshot } from '@/services/heteroAgentQuota';

import QuotaAccountSwitcher from './QuotaAccountSwitcher';
import type { FetchQuotaOptions, QuotaWindowItem } from './QuotaMenu';
import QuotaMenu, { createQuotaSourceKey } from './QuotaMenu';
import { buildClaudeSnapshotFromWindows, isQuotaStale, newestSeenAt } from './quotaViewModel';

/**
 * Hit the live Anthropic usage API when the newest persisted reading is this
 * stale, and auto-refresh on the same cadence so the badge stays near-live.
 * The sampler-side snapshot cache (90 s fresh window in the desktop main
 * process / device host) is what actually protects the rate-limited usage
 * endpoint.
 */
const QUOTA_REFRESH_MS = 2 * 60 * 1000;

const createErrorSnapshot = (error: unknown): ClaudeCodeQuotaSnapshot => ({
  error: error instanceof Error ? error.message : String(error),
  provider: 'claude-code',
  scopedWeekly: null,
  session: null,
  status: 'error',
  updatedAt: Date.now(),
  weekly: null,
});

const unavailableSnapshot = (
  reason?: ClaudeCodeQuotaSnapshot['reason'],
): ClaudeCodeQuotaSnapshot => ({
  error: null,
  provider: 'claude-code',
  reason,
  scopedWeekly: null,
  session: null,
  status: 'unavailable',
  updatedAt: Date.now(),
  weekly: null,
});

const isRateLimitError = (quota: ClaudeCodeQuotaSnapshot) => quota.error?.includes('429') ?? false;

interface ClaudeCodeQuotaMenuProps {
  /** Bound execution device to sample instead of the local desktop login. */
  deviceId?: string;
  env?: Record<string, string>;
}

const ClaudeCodeQuotaMenu = memo<ClaudeCodeQuotaMenuProps>(({ deviceId, env }) => {
  const { t } = useTranslation('chat');
  const agentId = useAgentId();
  const sourceKey = createQuotaSourceKey('claude-code', deviceId ?? 'local', env);
  // A persisted account becomes eligible for a device only after this mounted
  // menu has observed that device return the same external account identity.
  // This avoids painting another machine's pinned/first account on a device
  // switch while still preserving last-known-good data after later failures.
  const trustedDeviceAccountsRef = useRef(new Map<string, string>());

  /**
   * DB-first: render the persisted windows from our own database, and go to the
   * live Anthropic usage API to refresh + ingest when the newest persisted
   * reading is older than QUOTA_REFRESH_MS, the caller revalidates (focus /
   * popover open), or the user forces it. The persisted snapshot paints first
   * through onInterim, so the panel shows data instantly and survives a failing
   * live fetch.
   */
  const fetchQuota = useCallback(
    async (
      options?: FetchQuotaOptions<ClaudeCodeQuotaSnapshot>,
    ): Promise<ClaudeCodeQuotaSnapshot> => {
      const force = !!options?.force;

      // 1) Resolve the account to display — pinned for this agent, else the first.
      const [initialAccounts, bindings] = await Promise.all([
        agentQuotaService.listAccounts().catch(() => []),
        agentId ? agentQuotaService.listBindings(agentId).catch(() => []) : [],
      ]);
      let accounts = initialAccounts;
      let claude = accounts.filter((a) => a.provider === 'claude-code');
      const pinnedId = bindings.find((b) => b.role === 'pinned')?.accountId;
      const trustedExternalAccountId = deviceId
        ? trustedDeviceAccountsRef.current.get(deviceId)
        : undefined;
      let account = deviceId
        ? claude.find((a) => a.externalAccountId === trustedExternalAccountId)
        : (claude.find((a) => a.id === pinnedId) ?? claude[0]);
      let windows = account ? await agentQuotaService.getWindows(account.id).catch(() => []) : [];

      // 2) Throttled live refresh + ingest. Paint the persisted windows before
      // awaiting the live fetch so the panel never blocks on it.
      let live: ClaudeCodeQuotaSnapshot | null = null;
      if (
        force ||
        options?.revalidate ||
        (deviceId && !trustedExternalAccountId) ||
        isQuotaStale(account?.updatedAt, Date.now(), QUOTA_REFRESH_MS)
      ) {
        if (account && windows.length > 0) {
          options?.onInterim?.(buildClaudeSnapshotFromWindows(account, windows));
        }
        live = await fetchClaudeCodeQuotaSnapshot({ deviceId, env, force }).catch(() => null);

        const externalAccountId = live?.identity?.externalAccountId;
        if (live?.status === 'ok' && externalAccountId && live.readings?.length) {
          if (deviceId) trustedDeviceAccountsRef.current.set(deviceId, externalAccountId);

          // A revalidation inside the main-process cache's fresh window gets the
          // readings we already persisted echoed back (same capturedAt).
          // Snapshots are append-only, so re-ingesting an echo would duplicate
          // history rows and rerun calibration without new evidence — skip it.
          const newestCapturedAt = live.readings.reduce((max, r) => Math.max(max, r.capturedAt), 0);
          const matchingAccount = claude.find(
            (candidate) => candidate.externalAccountId === externalAccountId,
          );
          const matchingWindows = matchingAccount
            ? await agentQuotaService.getWindows(matchingAccount.id).catch(() => [])
            : [];
          const isCachedEcho =
            !!matchingAccount && newestCapturedAt <= newestSeenAt(matchingWindows);

          if (!isCachedEcho) {
            await agentQuotaService
              .ingestClaudeSnapshot({ deviceId, identity: live.identity!, readings: live.readings })
              .catch(() => {});
            accounts = await agentQuotaService.listAccounts().catch(() => accounts);
            claude = accounts.filter((a) => a.provider === 'claude-code');
            account =
              claude.find((a) => a.externalAccountId === externalAccountId) ??
              claude.find((a) => a.id === pinnedId) ??
              claude[0];
            windows = account
              ? await agentQuotaService.getWindows(account.id).catch(() => windows)
              : windows;
          } else {
            account = matchingAccount;
            windows = matchingWindows;
          }
        }
      }

      // 3) Persisted view wins — it survives a failed live fetch. Otherwise fall
      // back to the live snapshot: identity may be unresolvable (no
      // oauthAccount.accountUuid in ~/.claude.json, while the quota itself comes
      // from the keychain), or every reading may lack a usable reset and project
      // to zero windows. Either way real readings beat an empty panel.
      if (account && windows.length > 0) return buildClaudeSnapshotFromWindows(account, windows);
      return live ?? unavailableSnapshot();
    },
    [deviceId, env, agentId],
  );

  const getWindows = useCallback(
    (quota: ClaudeCodeQuotaSnapshot): QuotaWindowItem[] => [
      {
        compactGroup: 'global',
        compactLabel: t('heteroAgent.quota.session'),
        key: 'session',
        label: t('heteroAgent.quota.session'),
        window: quota.session,
      },
      {
        compactGroup: 'global',
        compactLabel: t('heteroAgent.quota.weekly'),
        key: 'weekly',
        label: t('heteroAgent.quota.weekly'),
        window: quota.weekly,
      },
      ...(quota.scopedWeekly
        ? [
            {
              compactGroup: 'scopedWeekly',
              compactLabel: quota.scopedWeekly.modelName,
              key: 'scopedWeekly',
              label: t('heteroAgent.claudeQuota.scopedWeekly', {
                model: quota.scopedWeekly.modelName,
              }),
              window: quota.scopedWeekly.window,
            },
          ]
        : []),
    ],
    [t],
  );

  const getUnavailableText = useCallback(
    (quota: ClaudeCodeQuotaSnapshot) => {
      switch (quota.reason) {
        case 'credentials-expired': {
          return t('heteroAgent.claudeQuota.unavailableExpired');
        }
        case 'credentials-not-found': {
          return t('heteroAgent.claudeQuota.unavailableNotFound');
        }
        case 'external-auth': {
          return t('heteroAgent.claudeQuota.unavailableExternalAuth');
        }
        default: {
          return undefined;
        }
      }
    },
    [t],
  );

  const getErrorText = useCallback(
    (quota: ClaudeCodeQuotaSnapshot) => {
      if (isRateLimitError(quota)) return t('heteroAgent.claudeQuota.errorRateLimited');
      // Never surface the raw fetch error (e.g. "fetch failed") — this branch only
      // shows when there is no persisted data to fall back to.
      return t('heteroAgent.claudeQuota.errorGeneric');
    },
    [t],
  );

  const getRefreshErrorText = useCallback(
    (quota: ClaudeCodeQuotaSnapshot) => {
      if (isRateLimitError(quota)) return t('heteroAgent.claudeQuota.refreshRateLimited');
    },
    [t],
  );

  return (
    <QuotaMenu
      autoRefreshMs={QUOTA_REFRESH_MS}
      createErrorSnapshot={createErrorSnapshot}
      fetchQuota={fetchQuota}
      getErrorText={getErrorText}
      getRefreshErrorText={getRefreshErrorText}
      getUnavailableText={getUnavailableText}
      getWindows={getWindows}
      renderHeader={(quota) => <QuotaAccountSwitcher placement="top" snapshot={quota} />}
      sourceKey={sourceKey}
      title={t('heteroAgent.claudeQuota.title')}
      tooltip={t('heteroAgent.claudeQuota.tooltip')}
    />
  );
});

ClaudeCodeQuotaMenu.displayName = 'ClaudeCodeQuotaMenu';

export default ClaudeCodeQuotaMenu;
