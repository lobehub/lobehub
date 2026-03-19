'use client';

import { Progress } from 'antd';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import Statistic from '@/components/Statistic';
import StatisticCard from '@/components/StatisticCard';
import TitleWithPercentage from '@/components/StatisticCard/TitleWithPercentage';
import { type UsageLog } from '@/types/usage/usageRecord';
import { formatNumber } from '@/utils/format';

import { type UsageChartProps } from '../../../types';

const computeMonth = (
  data: UsageLog[],
): {
  calls: number | string;
  spend: number | string;
} => {
  if (!data || data?.length === 0) return { calls: 0, spend: 0 };

  const spend = data.reduce((acc, log) => acc + (log.totalSpend || 0), 0);
  const calls = data.reduce((acc, log) => acc + (log.records?.length ?? 0), 0);

  return {
    calls: formatNumber(calls),
    spend: formatNumber(spend),
  };
};

const MonthSpend = memo<UsageChartProps>(({ data, isLoading, quota }) => {
  const { t } = useTranslation('auth');

  const { spend, calls } = computeMonth(data || []);

  const spendNum = typeof spend === 'number' ? spend : parseFloat(spend as string) || 0;
  const pct =
    quota?.effectiveMonthlyCostLimit != null && quota.effectiveMonthlyCostLimit > 0
      ? Math.min(100, (spendNum / quota.effectiveMonthlyCostLimit) * 100)
      : null;

  return (
    <>
      <StatisticCard
        loading={isLoading}
        title={<TitleWithPercentage title={t('usage.cards.month.title')} />}
        statistic={{
          description: <Statistic title={t('usage.cards.month.modelCalls')} value={calls} />,
          precision: 2,
          prefix: '$',
          value: spend,
        }}
      />
      {pct !== null && (
        <Progress
          percent={Math.round(pct)}
          size="small"
          status={pct >= 100 ? 'exception' : 'normal'}
          strokeColor={pct >= 80 && pct < 100 ? '#faad14' : undefined}
          style={{ marginTop: 8 }}
        />
      )}
    </>
  );
});

export default MonthSpend;
