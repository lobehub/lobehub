'use client';

import dayjs from 'dayjs';
import isToday from 'dayjs/plugin/isToday';
import isYesterday from 'dayjs/plugin/isYesterday';
import utc from 'dayjs/plugin/utc';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import Statistic from '@/components/Statistic';
import StatisticCard from '@/components/StatisticCard';
import TitleWithPercentage from '@/components/StatisticCard/TitleWithPercentage';
import type {UsageLog} from '@/types/usage/usageRecord';
import { formatNumber } from '@/utils/format';

import type {UsageChartProps} from '../../../types';

dayjs.extend(utc);
dayjs.extend(isToday);
dayjs.extend(isYesterday);

const computeSpend = (
  data: UsageLog[],
): {
  today: number | string;
  yesterday: number | string;
} => {
  if (!data || data?.length === 0) return { today: 0, yesterday: 0 };

  const today = data.find((log) => dayjs.utc(log.day).isToday())?.totalSpend ?? 0;
  const yesterday = data.find((log) => dayjs.utc(log.day).isYesterday())?.totalSpend ?? 0;

  return {
    today: formatNumber(today),
    yesterday: formatNumber(yesterday),
  };
};

const TodaySpend = memo<UsageChartProps>(({ data, isLoading }) => {
  const { t } = useTranslation('auth');

  const { today, yesterday } = computeSpend(data || []);

  return (
    <StatisticCard
      loading={isLoading}
      statistic={{
        description: <Statistic title={t('usage.cards.today.yesterday')} value={yesterday} />,
        precision: 2,
        prefix: '$',
        value: today,
      }}
      title={
        <TitleWithPercentage
          count={typeof today === 'number' ? today : 0}
          prvCount={typeof yesterday === 'number' ? yesterday : 0}
          title={t('usage.cards.today.title')}
        />
      }
    />
  );
});

export default TodaySpend;
