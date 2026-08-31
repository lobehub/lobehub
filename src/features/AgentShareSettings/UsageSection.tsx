'use client';

import { Flexbox, Skeleton } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { Progress } from 'antd';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { shareKeys } from '@/libs/swr/keys';
import { agentShareService } from '@/services/agentShare';
import { formatPrice } from '@/utils/format';

import { Section } from './SectionLayout';

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
const UsageSection = memo<UsageSectionProps>(({ agentId }) => {
  const { t } = useTranslation('agent');

  const { data, isLoading } = useSWR(
    shareKeys.agentShareStats(agentId),
    () => agentShareService.getShareStats(agentId),
    { revalidateOnFocus: false },
  );

  const spend = data?.monthlySpend ?? null;
  const limit = data?.monthlySpendLimit ?? null;
  // `0` is a real cap ("stop everything"), so it must not fall back to the
  // unlimited branch; the zero case is special-cased below to avoid dividing
  // by it in the progress computation.
  const hasLimit = limit !== null;

  return (
    <Section desc={t('share.settings.usage.desc')} title={t('share.settings.usage.title')}>
      {isLoading && !data ? (
        <Skeleton active paragraph={{ rows: 2 }} title={false} />
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
                  {hasLimit
                    ? t('share.settings.usage.spendOfLimit', {
                        limit: formatPrice(limit),
                        spend: formatPrice(spend),
                      })
                    : t('share.settings.usage.spendNoLimit', { spend: formatPrice(spend) })}
                </Text>
              </Flexbox>
              {hasLimit && (
                <Progress
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
