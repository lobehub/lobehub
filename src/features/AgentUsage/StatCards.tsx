'use client';

import { Grid } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import Statistic from '@/components/Statistic';
import StatisticCard from '@/components/StatisticCard';
import { formatNumber } from '@/utils/format';

import { type AgentUsageSummary } from './hooks';

interface StatCardsProps {
  isLoading?: boolean;
  summary: AgentUsageSummary;
}

const StatCards = memo<StatCardsProps>(({ summary, isLoading }) => {
  const { t } = useTranslation('setting');

  return (
    <Grid gap={8} maxItemWidth={200} rows={3}>
      <StatisticCard
        loading={isLoading}
        title={t('usageStats.cards.totalCost')}
        statistic={{
          precision: 2,
          prefix: '$',
          value: formatNumber(summary.totalSpend, 2),
        }}
      />
      <StatisticCard
        loading={isLoading}
        title={t('usageStats.cards.totalTokens')}
        statistic={{
          description: (
            <Statistic
              title={t('usageStats.cards.inputOutput')}
              value={`${formatNumber(summary.totalInputTokens)} / ${formatNumber(
                summary.totalOutputTokens,
              )}`}
            />
          ),
          value: formatNumber(summary.totalTokens),
        }}
      />
      <StatisticCard
        loading={isLoading}
        title={t('usageStats.cards.totalRequests')}
        statistic={{
          value: formatNumber(summary.totalRequests),
        }}
      />
    </Grid>
  );
});

export default StatCards;
