'use client';

import { Flexbox, Skeleton } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { Progress } from 'antd';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { formatPrice } from '@/utils/format';

import { Section } from './SectionLayout';
import { useShareUsage } from './useShareUsage';

interface StatProps {
  label: string;
  value: number;
}

const Stat = memo<StatProps>(({ label, value }) => (
  <Flexbox flex={1} gap={2}>
    <Text fontSize={20} weight={600}>
      {value}
    </Text>
    <Text fontSize={12} type={'secondary'}>
      {label}
    </Text>
  </Flexbox>
));

Stat.displayName = 'AgentShareUsageStat';

interface UsageSectionProps {
  agentId: string;
  /** Live configured cap from the share-status cache; see `useShareUsage`. */
  monthlySpendLimit?: number;
}

/**
 * Read-only roll-up of what a share has actually cost and attracted: page
 * views, distinct visitors, visitor conversations, and this month's spend
 * against the cap configured in `LimitsSection`.
 *
 * Aggregates only — the creator's visibility into individual visitor
 * CONVERSATIONS stays governed by `allowCreatorViewSessions`, which these
 * counts deliberately do not bypass.
 */
const UsageSection = memo<UsageSectionProps>(({ agentId, monthlySpendLimit }) => {
  const { t } = useTranslation('agent');

  const { data, error, hasLoadError, isLoading, isValidating, limit, mutate, spend } =
    useShareUsage(agentId, monthlySpendLimit);

  return (
    <Section desc={t('share.settings.usage.desc')} title={t('share.settings.usage.title')}>
      {isLoading ? (
        <Skeleton active paragraph={{ rows: 2 }} title={false} />
      ) : hasLoadError ? (
        <AsyncError
          error={error}
          retrying={isValidating}
          title={t('share.settings.usage.loadFailed')}
          variant={'inline'}
          onRetry={() => void mutate()}
        />
      ) : (
        <Flexbox gap={16}>
          <Flexbox horizontal gap={16}>
            <Stat label={t('share.settings.usage.views')} value={data?.userViewCount ?? 0} />
            <Stat label={t('share.settings.usage.visitors')} value={data?.visitorCount ?? 0} />
            <Stat label={t('share.settings.usage.conversations')} value={data?.topicCount ?? 0} />
          </Flexbox>
          {/* `null` means this deployment does not meter share spend — show
              nothing rather than a misleading $0. */}
          {spend !== null && (
            <Flexbox gap={4}>
              <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
                <Text fontSize={12} type={'secondary'}>
                  {t('share.settings.usage.monthlySpend')}
                </Text>
                <Text fontSize={12}>
                  {limit === undefined
                    ? formatPrice(spend)
                    : t('share.settings.usage.spendOfLimit', {
                        limit: formatPrice(limit),
                        spend: formatPrice(spend),
                      })}
                </Text>
              </Flexbox>
              {limit !== undefined && (
                <Progress
                  // A `0` cap ("stop all visitor runs") is special-cased so the
                  // progress computation never divides by it.
                  percent={limit === 0 ? 100 : Math.min(100, Math.round((spend / limit) * 100))}
                  showInfo={false}
                  size={'small'}
                  status={spend >= limit ? 'exception' : 'normal'}
                />
              )}
            </Flexbox>
          )}
        </Flexbox>
      )}
    </Section>
  );
});

UsageSection.displayName = 'AgentShareUsageSection';

export default UsageSection;
