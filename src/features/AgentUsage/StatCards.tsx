'use client';

import { Grid, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import StatisticCard from '@/components/StatisticCard';
import { type AgentUsageStats } from '@/types/usage/usageRecord';
import { formatNumber, formatUsageValue } from '@/utils/format';

interface StatCardsProps {
  isLoading?: boolean;
  rangeLabel: string;
  summary: AgentUsageStats['summary'];
}

const desc = (text: string) => (
  <Text fontSize={12} type={'secondary'}>
    {text}
  </Text>
);

const StatCards = memo<StatCardsProps>(({ summary, isLoading, rangeLabel }) => {
  const { t } = useTranslation('spend');
  const suffix = ` · ${rangeLabel}`;

  return (
    <Grid gap={8} maxItemWidth={240} rows={3}>
      <StatisticCard
        loading={isLoading}
        title={t('usageStats.cards.cost') + suffix}
        statistic={{
          precision: 2,
          prefix: '$',
          value: formatNumber(summary.totalCost, 2),
        }}
      />
      <StatisticCard
        loading={isLoading}
        title={t('usageStats.cards.cacheSavings') + suffix}
        statistic={{
          description: desc(
            t('usageStats.cards.cacheDesc', {
              rate: String(Math.round(summary.cacheHitRate * 100)),
              read: formatUsageValue(summary.cacheReadTokens),
            }),
          ),
          precision: 2,
          prefix: '$',
          value: formatNumber(summary.cacheSavings, 2),
          valueStyle: { color: cssVar.colorSuccess },
        }}
      />
      <StatisticCard
        loading={isLoading}
        title={t('usageStats.cards.token') + suffix}
        statistic={{
          description: desc(
            t('usageStats.cards.tokenDesc', {
              input: formatUsageValue(summary.inputTokens),
              output: formatUsageValue(summary.outputTokens),
            }),
          ),
          value: formatUsageValue(summary.totalTokens),
        }}
      />
    </Grid>
  );
});

export default StatCards;
