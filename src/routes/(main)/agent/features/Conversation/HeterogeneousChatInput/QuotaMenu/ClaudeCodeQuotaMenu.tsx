'use client';

import type { ClaudeCodeQuotaSnapshot } from '@lobechat/electron-client-ipc';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentId } from '@/features/ChatInput/hooks/useAgentId';
import { agentQuotaService } from '@/services/agentQuota';
import { heterogeneousAgentService } from '@/services/electron/heterogeneousAgent';

import QuotaAccountSwitcher from './QuotaAccountSwitcher';
import type { FetchQuotaOptions, QuotaWindowItem } from './QuotaMenu';
import QuotaMenu, { createQuotaSourceKey } from './QuotaMenu';
import { buildClaudeSnapshotFromWindows, isQuotaStale } from './quotaViewModel';

/**
 * Only hit the live Anthropic usage API when the persisted data is this stale.
 * Kept low-frequency (1h) — the panel reads from our DB, so it stays instant and
 * fresh-enough without hammering the rate-limited usage endpoint. A manual
 * refresh always forces a live fetch.
 */
const QUOTA_REFRESH_MS = 60 * 60 * 1000;

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
  env?: Record<string, string>;
}

const ClaudeCodeQuotaMenu = memo<ClaudeCodeQuotaMenuProps>(({ env }) => {
  const { t } = useTranslation('chat');
  const agentId = useAgentId();
  const sourceKey = createQuotaSourceKey('claude-code', env);

  /**
   * DB-first: render the persisted windows from our own database, and only fall
   * back to the live Anthropic usage API to refresh + ingest when the newest
   * persisted reading is older than QUOTA_REFRESH_MS (or the user forces it). So
   * the panel shows data instantly and survives a failing live fetch.
   */
  const fetchQuota = useCallback(
    async (options?: FetchQuotaOptions): Promise<ClaudeCodeQuotaSnapshot> => {
      const force = !!options?.force;

      // 1) Resolve the account to display — pinned for this agent, else the first.
      let accounts = await agentQuotaService.listAccounts().catch(() => []);
      let claude = accounts.filter((a) => a.provider === 'claude-code');
      let pinnedId: string | undefined;
      if (agentId) {
        const bindings = await agentQuotaService.listBindings(agentId).catch(() => []);
        pinnedId = bindings.find((b) => b.role === 'pinned')?.accountId;
      }
      let account = claude.find((a) => a.id === pinnedId) ?? claude[0];
      let windows = account ? await agentQuotaService.getWindows(account.id).catch(() => []) : [];

      // 2) Throttled live refresh + ingest.
      let live: ClaudeCodeQuotaSnapshot | null = null;
      if (force || isQuotaStale(windows, Date.now(), QUOTA_REFRESH_MS)) {
        live = await heterogeneousAgentService
          .getClaudeCodeQuota({ env, ...(force ? { force: true } : {}) })
          .catch(() => null);

        const externalAccountId = live?.identity?.externalAccountId;
        if (live?.status === 'ok' && externalAccountId && live.readings?.length) {
          await agentQuotaService
            .ingestClaudeSnapshot({ identity: live.identity!, readings: live.readings })
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
    [env, agentId],
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
