'use client';

import type { ClaudeCodeQuotaSnapshot } from '@lobechat/electron-client-ipc';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { heterogeneousAgentService } from '@/services/electron/heterogeneousAgent';

import QuotaMenu, { type QuotaWindowItem } from './QuotaMenu';

const createErrorSnapshot = (error: unknown): ClaudeCodeQuotaSnapshot => ({
  error: error instanceof Error ? error.message : String(error),
  provider: 'claude-code',
  scopedWeekly: null,
  session: null,
  status: 'error',
  updatedAt: Date.now(),
  weekly: null,
});

interface ClaudeCodeQuotaMenuProps {
  env?: Record<string, string>;
}

const ClaudeCodeQuotaMenu = memo<ClaudeCodeQuotaMenuProps>(({ env }) => {
  const { t } = useTranslation('chat');

  const fetchQuota = useCallback(
    () => heterogeneousAgentService.getClaudeCodeQuota({ env }),
    [env],
  );

  const getWindows = useCallback(
    (quota: ClaudeCodeQuotaSnapshot): QuotaWindowItem[] => [
      { key: 'session', label: t('heteroAgent.quota.session'), window: quota.session },
      { key: 'weekly', label: t('heteroAgent.quota.weekly'), window: quota.weekly },
      ...(quota.scopedWeekly
        ? [
            {
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

  return (
    <QuotaMenu
      createErrorSnapshot={createErrorSnapshot}
      fetchQuota={fetchQuota}
      getUnavailableText={getUnavailableText}
      getWindows={getWindows}
      title={t('heteroAgent.claudeQuota.title')}
      tooltip={t('heteroAgent.claudeQuota.tooltip')}
    />
  );
});

ClaudeCodeQuotaMenu.displayName = 'ClaudeCodeQuotaMenu';

export default ClaudeCodeQuotaMenu;
