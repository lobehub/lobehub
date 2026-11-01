'use client';

import { isDesktop } from '@lobechat/const';
import type { ClaudeCodeQuotaSnapshot } from '@lobechat/electron-client-ipc';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentId } from '@/features/ChatInput/hooks/useAgentId';
import { useSingleton } from '@/hooks/useSingleton';
import { agentQuotaService } from '@/services/agentQuota';
import { heterogeneousAgentService } from '@/services/electron/heterogeneousAgent';
import { fetchClaudeCodeQuotaSnapshot } from '@/services/heteroAgentQuota';
import { getAgentQuotaStoreState } from '@/store/agentQuota';
import { getElectronStoreState } from '@/store/electron';

import QuotaAccountSwitcher from './QuotaAccountSwitcher';
import type { FetchQuotaOptions, QuotaWindowItem } from './QuotaMenu';
import QuotaMenu, { createQuotaSourceKey } from './QuotaMenu';
import {
  buildClaudePanelSnapshot,
  hasRenderableWindow,
  isQuotaStale,
  newestCapturedAt,
} from './quotaViewModel';

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

/**
 * Persisted windows merged with a live sample that came back unavailable keep
 * the live reason, so the panel can say why the windows stopped refreshing.
 */
type ClaudeCodePanelSnapshot = ClaudeCodeQuotaSnapshot & {
  refreshUnavailableReason?: ClaudeCodeQuotaSnapshot['reason'];
  sampleFailed?: boolean;
};

/**
 * Env that samples the local login a pinned account runs on: its profile, the
 * default login, or `null` when this desktop has no login for it (sampling
 * the default login then would paint another account's quota under its name).
 * An agent env that picks its own profile already wins over routing.
 */
const resolvePinnedSampleEnv = async (
  externalAccountId: string | null | undefined,
  env: Record<string, string> | undefined,
): Promise<Record<string, string> | undefined | null> => {
  if (!isDesktop || !externalAccountId || env?.CLAUDE_CONFIG_DIR) return env;
  const resolution = await heterogeneousAgentService
    .resolveClaudeCodeAccount(externalAccountId)
    .catch(() => null);
  if (resolution?.kind === 'profile') return { ...env, CLAUDE_CONFIG_DIR: resolution.configDir };
  if (resolution?.kind === 'missing') return null;
  return env;
};

const isRateLimitError = (quota: ClaudeCodeQuotaSnapshot) => quota.error?.includes('429') ?? false;

interface ClaudeCodeQuotaMenuProps {
  /** Bound execution device to sample instead of the local desktop login. */
  deviceId?: string;
  env?: Record<string, string>;
}

const ClaudeCodeQuotaMenu = memo<ClaudeCodeQuotaMenuProps>(({ deviceId, env }) => {
  const { t } = useTranslation('chat');
  const agentId = useAgentId();
  const sourceKey = createQuotaSourceKey('claude-code', agentId, deviceId ?? 'local', env);
  // A persisted account becomes eligible for a device only after this mounted
  // menu has observed that device return the same external account identity.
  // This avoids painting another machine's pinned/first account on a device
  // switch while still preserving last-known-good data after later failures.
  const trustedDeviceAccounts = useSingleton(() => new Map<string, string>());

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
      options?: FetchQuotaOptions<ClaudeCodePanelSnapshot>,
    ): Promise<ClaudeCodePanelSnapshot> => {
      const force = !!options?.force;
      const quotaStore = getAgentQuotaStoreState();

      // 1) Resolve the account to display — pinned for this agent on this
      // desktop (its own pick, else the agent-wide pin), else the first.
      const localDeviceId =
        isDesktop && !deviceId && agentId
          ? await getElectronStoreState().resolveGatewayDeviceId()
          : undefined;
      const [initialAccounts, bindings, deviceAccount] = await Promise.all([
        quotaStore.readQuotaAccounts().catch(() => []),
        agentId ? quotaStore.readQuotaBindings(agentId).catch(() => []) : [],
        agentId && localDeviceId
          ? quotaStore.readQuotaDeviceAccount(agentId, localDeviceId).catch(() => null)
          : null,
      ]);
      let accounts = initialAccounts;
      let claude = accounts.filter((a) => a.provider === 'claude-code');
      // A pick whose account has since left the agent's rotation no longer
      // routes runs (as at spawn), so it is not what this panel shows either.
      const devicePickId = bindings.some(
        (b) => b.accountId === deviceAccount?.accountId && b.enabled && b.role !== 'disabled',
      )
        ? deviceAccount?.accountId
        : undefined;
      const pinnedId = devicePickId ?? bindings.find((b) => b.role === 'pinned')?.accountId;
      const trustedExternalAccountId = deviceId ? trustedDeviceAccounts.get(deviceId) : undefined;
      let account = deviceId
        ? claude.find((a) => a.externalAccountId === trustedExternalAccountId)
        : (claude.find((a) => a.id === pinnedId) ?? claude[0]);
      let readings = account ? await quotaStore.readQuotaReadings(account.id).catch(() => []) : [];

      // 2) Throttled live refresh + ingest. Paint the persisted windows before
      // awaiting the live fetch so the panel never blocks on it.
      let live: ClaudeCodeQuotaSnapshot | null = null;
      let liveFailed = false;
      if (
        force ||
        options?.revalidate ||
        (deviceId && !trustedExternalAccountId) ||
        isQuotaStale(account?.updatedAt, Date.now(), QUOTA_REFRESH_MS)
      ) {
        if (account && readings.length > 0) {
          const interim = buildClaudePanelSnapshot(account, readings, null);
          if (hasRenderableWindow(interim)) options?.onInterim?.(interim);
        }
        // Auto mode may route a run to any local login, and it balances on
        // their readings: keep every local login sampled, not just this one.
        // Never awaited — the panel must not wait on the other logins.
        if (isDesktop && !deviceId) void quotaStore.refreshClaudeLocalAccounts().catch(() => {});
        // A local pin runs on that account's own login: sample that login, not
        // the default one, or the panel would show another account's quota.
        const sampleEnv =
          !deviceId && pinnedId && account?.id === pinnedId
            ? await resolvePinnedSampleEnv(account.externalAccountId, env)
            : env;
        live =
          sampleEnv === null
            ? null
            : await fetchClaudeCodeQuotaSnapshot({ deviceId, env: sampleEnv, force }).catch(() => {
                liveFailed = true;
                return null;
              });

        const externalAccountId = live?.identity?.externalAccountId;
        if (live?.status === 'ok' && externalAccountId && live.readings?.length) {
          if (deviceId) trustedDeviceAccounts.set(deviceId, externalAccountId);

          // A revalidation inside the main-process cache's fresh window gets the
          // readings we already persisted echoed back (same capturedAt).
          // Snapshots are append-only, so re-ingesting an echo would duplicate
          // history rows and rerun calibration without new evidence — skip it.
          const liveCapturedAt = live.readings.reduce((max, r) => Math.max(max, r.capturedAt), 0);
          const matchingAccount = claude.find(
            (candidate) => candidate.externalAccountId === externalAccountId,
          );
          const matchingReadings = matchingAccount
            ? await quotaStore.readQuotaReadings(matchingAccount.id).catch(() => [])
            : [];
          const isCachedEcho =
            !!matchingAccount && liveCapturedAt <= newestCapturedAt(matchingReadings);

          if (!isCachedEcho) {
            await agentQuotaService
              .ingestClaudeSnapshot({ deviceId, identity: live.identity!, readings: live.readings })
              .catch(() => {});
            accounts = await quotaStore.readQuotaAccounts({ fresh: true }).catch(() => accounts);
            claude = accounts.filter((a) => a.provider === 'claude-code');
            account =
              claude.find((a) => a.externalAccountId === externalAccountId) ??
              claude.find((a) => a.id === pinnedId) ??
              claude[0];
            readings = account
              ? await quotaStore
                  .readQuotaReadings(account.id, { fresh: true })
                  .catch(() => readings)
              : readings;
          } else {
            account = matchingAccount;
            readings = matchingReadings;
          }
        }
      }

      // 3) The persisted view survives a failed live fetch, and an attributable
      // live sample fills what it has no reading for (an ingest that failed, a
      // limit this account has no history for) — merged per limit, newest
      // reading wins. With no account resolved at all there is nothing to
      // attribute the sample to, so the live snapshot stands on its own.
      const merged = account ? buildClaudePanelSnapshot(account, readings, live) : null;
      if (merged && hasRenderableWindow(merged)) {
        return live?.status === 'unavailable' && live.reason
          ? { ...merged, refreshUnavailableReason: live.reason }
          : merged;
      }
      // A failed live fetch with nothing to show still reads as "unavailable",
      // but flagged, so the panel keeps the last snapshot it already shows.
      if (!live && liveFailed) return { ...unavailableSnapshot(), sampleFailed: true };
      return live ?? merged ?? unavailableSnapshot();
    },
    [agentId, deviceId, env, trustedDeviceAccounts],
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

  const getReasonText = useCallback(
    (reason: ClaudeCodeQuotaSnapshot['reason']) => {
      switch (reason) {
        case 'credentials-expired': {
          return t('heteroAgent.claudeQuota.unavailableExpired');
        }
        case 'credentials-not-found': {
          return t('heteroAgent.claudeQuota.unavailableNotFound');
        }
        case 'external-auth': {
          return t('heteroAgent.claudeQuota.unavailableExternalAuth');
        }
        case 'request-blocked': {
          return t('heteroAgent.claudeQuota.unavailableRequestBlocked');
        }
        default: {
          return undefined;
        }
      }
    },
    [t],
  );

  const getUnavailableText = useCallback(
    (quota: ClaudeCodeQuotaSnapshot) => getReasonText(quota.reason),
    [getReasonText],
  );

  const getStaleNotice = useCallback(
    (quota: ClaudeCodePanelSnapshot) =>
      quota.refreshUnavailableReason ? getReasonText(quota.refreshUnavailableReason) : undefined,
    [getReasonText],
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
      // The account manager is where accounts are added and switched, and an
      // account with no readings yet is exactly when it is needed.
      alwaysRenderHeader
      autoRefreshMs={QUOTA_REFRESH_MS}
      createErrorSnapshot={createErrorSnapshot}
      fetchQuota={fetchQuota}
      getErrorText={getErrorText}
      getRefreshErrorText={getRefreshErrorText}
      getStaleNotice={getStaleNotice}
      getUnavailableText={getUnavailableText}
      getWindows={getWindows}
      sourceKey={sourceKey}
      title={t('heteroAgent.claudeQuota.title')}
      tooltip={t('heteroAgent.claudeQuota.tooltip')}
      renderHeader={(quota) => (
        <QuotaAccountSwitcher
          deviceId={deviceId}
          placement="top"
          provider="claude-code"
          snapshot={quota}
        />
      )}
    />
  );
});

ClaudeCodeQuotaMenu.displayName = 'ClaudeCodeQuotaMenu';

export default ClaudeCodeQuotaMenu;
