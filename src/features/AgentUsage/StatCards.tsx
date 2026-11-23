'use client';

import { cssVar, Grid, Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { AgentStatCardsSkeleton } from '@/components/Skeleton/AgentStatistics';
import StatisticCard from '@/components/StatisticCard';
import { useShowMemberTokenUsage } from '@/hooks/useShowMemberTokenUsage';
import { type AgentUsageStats } from '@/types/usage/usageRecord';
import { formatNumber, formatUsageValue } from '@/utils/format';
import { usageAmountSuffix } from '@/utils/usageCostLabel';
import { usageAmount, usageAmountPrefix } from '@/utils/usageCredits';

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
  const showMemberTokenUsage = useShowMemberTokenUsage();
  const { t } = useTranslation('spend');
  const suffix = ` · ${rangeLabel}`;

  // Same shape as the route skeleton, so the route → data wait hands over
  // without the cards flashing `$0.00` behind a spinner.
  if (isLoading) return <AgentStatCardsSkeleton />;

  return (
    <Grid gap={8} maxItemWidth={240} rows={showMemberTokenUsage ? 3 : 2}>
      <StatisticCard
        title={t('usageStats.cards.cost') + suffix}
        statistic={{
          precision: 2,
          prefix: usageAmountPrefix(),
          suffix: usageAmountSuffix(),
          value: formatNumber(usageAmount(summary.totalCost), 2),
        }}
      />
      <StatisticCard
        title={t('usageStats.cards.cacheSavings') + suffix}
        statistic={{
          description:
            showMemberTokenUsage &&
            desc(
              t('usageStats.cards.cacheDesc', {
                rate: String(Math.round(summary.cacheHitRate * 100)),
                read: formatUsageValue(summary.cacheReadTokens),
              }),
            ),
          precision: 2,
          prefix: usageAmountPrefix(),
          suffix: usageAmountSuffix(),
          value: formatNumber(usageAmount(summary.cacheSavings), 2),
          valueStyle: { color: cssVar.colorSuccess },
        }}
      />
      {showMemberTokenUsage && (
        <StatisticCard
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
      )}
    </Grid>
  );
});

export default StatCards;
