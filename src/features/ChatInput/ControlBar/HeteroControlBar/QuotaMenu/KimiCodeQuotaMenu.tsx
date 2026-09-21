'use client';

import type { KimiCodeQuotaSnapshot } from '@lobechat/heterogeneous-agents/quota';
import { Flexbox, Icon } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { WalletIcon } from 'lucide-react';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentId } from '@/features/ChatInput/hooks/useAgentId';
import { createKimiCodeQuotaReader } from '@/services/kimiCodeQuota';

import type { QuotaWindowItem } from './QuotaMenu';
import QuotaMenu, { createQuotaSourceKey } from './QuotaMenu';

const styles = createStaticStyles(({ css }) => ({
  extraUsage: css`
    padding-block-start: 8px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
}));

const createErrorSnapshot = (error: unknown): KimiCodeQuotaSnapshot => ({
  error: error instanceof Error ? error.message : String(error),
  extraUsage: null,
  monthly: null,
  monthlyCode: null,
  provider: 'kimi-code',
  session: null,
  status: 'error',
  updatedAt: Date.now(),
  weekly: null,
});

const formatCents = (cents: number, currency: string) => {
  try {
    return new Intl.NumberFormat(undefined, { currency, style: 'currency' }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
};

interface KimiCodeQuotaMenuProps {
  deviceId?: string;
  env?: Record<string, string>;
}

const KimiCodeQuotaMenu = memo<KimiCodeQuotaMenuProps>(({ deviceId, env }) => {
  const { t } = useTranslation('chat');
  const agentId = useAgentId();
  const sourceKey = createQuotaSourceKey('kimi-code', agentId, deviceId, env);

  const fetchQuota = useMemo(
    () => createKimiCodeQuotaReader({ agentId, deviceId, env }),
    [agentId, deviceId, env],
  );

  const getWindows = useCallback(
    (quota: KimiCodeQuotaSnapshot): QuotaWindowItem[] => [
      {
        key: 'session',
        label: t('heteroAgent.kimiCodeQuota.fiveHour'),
        window: quota.session,
      },
      {
        key: 'weekly',
        label: t('heteroAgent.quota.weekly'),
        window: quota.weekly,
      },
      {
        key: 'monthly',
        label: t('heteroAgent.kimiCodeQuota.monthly'),
        window: quota.monthly,
      },
      {
        key: 'monthlyCode',
        label: t('heteroAgent.kimiCodeQuota.monthlyCode'),
        window: quota.monthlyCode,
      },
    ],
    [t],
  );

  const hasExtraData = useCallback((quota: KimiCodeQuotaSnapshot) => !!quota.extraUsage, []);

  const getUnavailableText = useCallback(
    (quota: KimiCodeQuotaSnapshot) => {
      switch (quota.reason) {
        case 'credentials-expired': {
          return t('heteroAgent.kimiCodeQuota.unavailableExpired');
        }
        case 'credentials-not-found': {
          return t('heteroAgent.kimiCodeQuota.unavailableNotFound');
        }
        default: {
          return undefined;
        }
      }
    },
    [t],
  );

  const getErrorText = useCallback(() => t('heteroAgent.kimiCodeQuota.errorGeneric'), [t]);

  const renderFooter = useCallback(
    (quota: KimiCodeQuotaSnapshot) => {
      const extraUsage = quota.extraUsage;
      if (!extraUsage) return null;

      return (
        <Flexbox className={styles.extraUsage} gap={4}>
          <Flexbox horizontal align={'center'} justify={'space-between'}>
            <Flexbox horizontal align={'center'} gap={4}>
              <Icon icon={WalletIcon} size={14} />
              <Text strong style={{ fontSize: 12 }}>
                {t('heteroAgent.kimiCodeQuota.extraUsage')}
              </Text>
            </Flexbox>
            <Text style={{ fontSize: 12 }}>
              {formatCents(extraUsage.balanceCents, extraUsage.currency)}
            </Text>
          </Flexbox>
          {extraUsage.monthlyChargeLimitEnabled && (
            <Text color={cssVar.colorTextTertiary} style={{ fontSize: 12 }}>
              {t('heteroAgent.kimiCodeQuota.monthlyCap', {
                limit: formatCents(extraUsage.monthlyChargeLimitCents, extraUsage.currency),
                used: formatCents(extraUsage.monthlyUsedCents, extraUsage.currency),
              })}
            </Text>
          )}
        </Flexbox>
      );
    },
    [t],
  );

  return (
    <QuotaMenu
      contentWidth={320}
      createErrorSnapshot={createErrorSnapshot}
      fetchQuota={fetchQuota}
      getErrorText={getErrorText}
      getRefreshErrorText={getErrorText}
      getUnavailableText={getUnavailableText}
      getWindows={getWindows}
      hasExtraData={hasExtraData}
      renderFooter={renderFooter}
      sourceKey={sourceKey}
      title={t('heteroAgent.kimiCodeQuota.title')}
      tooltip={t('heteroAgent.kimiCodeQuota.tooltip')}
    />
  );
});

KimiCodeQuotaMenu.displayName = 'KimiCodeQuotaMenu';

export default KimiCodeQuotaMenu;
