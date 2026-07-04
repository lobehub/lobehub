'use client';

import type { CodexQuotaSnapshot } from '@lobechat/electron-client-ipc';
import { Flexbox, Icon, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { RotateCcwIcon } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { heterogeneousAgentService } from '@/services/electron/heterogeneousAgent';

import QuotaMenu, { type QuotaMenuHelpers, type QuotaWindowItem } from './QuotaMenu';

const styles = createStaticStyles(({ css }) => ({
  resetCredits: css`
    padding-block-start: 8px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
}));

const createErrorSnapshot = (error: unknown): CodexQuotaSnapshot => ({
  error: error instanceof Error ? error.message : String(error),
  provider: 'codex',
  rateLimitResetCredits: null,
  session: null,
  status: 'error',
  updatedAt: Date.now(),
  weekly: null,
});

interface CodexQuotaMenuProps {
  command?: string;
  env?: Record<string, string>;
}

const CodexQuotaMenu = memo<CodexQuotaMenuProps>(({ command, env }) => {
  const { t } = useTranslation('chat');

  const fetchQuota = useCallback(
    () => heterogeneousAgentService.getCodexQuota({ command, env }),
    [command, env],
  );

  const getWindows = useCallback(
    (quota: CodexQuotaSnapshot): QuotaWindowItem[] => [
      { key: 'session', label: t('heteroAgent.quota.session'), window: quota.session },
      { key: 'weekly', label: t('heteroAgent.quota.weekly'), window: quota.weekly },
    ],
    [t],
  );

  const hasExtraData = useCallback(
    (quota: CodexQuotaSnapshot) => !!quota.rateLimitResetCredits,
    [],
  );

  const renderFooter = useCallback(
    (quota: CodexQuotaSnapshot, { formatDuration, now }: QuotaMenuHelpers) => {
      const resetCreditCount = quota.rateLimitResetCredits?.availableCount;
      const resetCreditExpiry = quota.rateLimitResetCredits?.nextExpiresAt;

      if (resetCreditCount === undefined)
        return (
          <Flexbox className={styles.resetCredits} gap={4}>
            <Flexbox horizontal align={'center'} gap={6}>
              <Icon icon={RotateCcwIcon} size={13} />
              <Text style={{ fontSize: 12 }} type="secondary">
                {t('heteroAgent.codexQuota.resetCreditsUnavailable')}
              </Text>
            </Flexbox>
          </Flexbox>
        );

      let expiryLabel: string | undefined;
      if (resetCreditExpiry) {
        const duration = formatDuration(resetCreditExpiry - now);
        if (duration) {
          expiryLabel =
            resetCreditCount > 1
              ? t('heteroAgent.codexQuota.nextExpiresIn', { duration })
              : t('heteroAgent.codexQuota.expiresIn', { duration });
        }
      }

      return (
        <Flexbox className={styles.resetCredits} gap={4}>
          <Flexbox horizontal align={'center'} gap={6}>
            <Icon icon={RotateCcwIcon} size={13} />
            <Text strong style={{ fontSize: 12 }}>
              {t('heteroAgent.codexQuota.resetCredits', { count: resetCreditCount })}
            </Text>
          </Flexbox>
          {expiryLabel && (
            <Text style={{ fontSize: 12 }} type="secondary">
              {expiryLabel}
            </Text>
          )}
        </Flexbox>
      );
    },
    [t],
  );

  return (
    <QuotaMenu
      createErrorSnapshot={createErrorSnapshot}
      fetchQuota={fetchQuota}
      getWindows={getWindows}
      hasExtraData={hasExtraData}
      renderFooter={renderFooter}
      title={t('heteroAgent.codexQuota.title')}
      tooltip={t('heteroAgent.codexQuota.tooltip')}
    />
  );
});

CodexQuotaMenu.displayName = 'CodexQuotaMenu';

export default CodexQuotaMenu;
