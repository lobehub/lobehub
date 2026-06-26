'use client';

import { BarChart } from '@lobehub/charts';
import { Block, Flexbox, Segmented, Skeleton, Text } from '@lobehub/ui';
import dayjs from 'dayjs';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { type UsageLog } from '@/types/usage/usageRecord';
import { formatNumber, formatTokenNumber } from '@/utils/format';

enum ShowType {
  Spend = 'spend',
  Token = 'token',
}

interface UsageTrendChartProps {
  data?: UsageLog[];
  isLoading?: boolean;
}

const UsageTrendChart = memo<UsageTrendChartProps>(({ data, isLoading }) => {
  const { t } = useTranslation('setting');
  const [type, setType] = useState<ShowType>(ShowType.Spend);

  const seriesKey =
    type === ShowType.Spend ? t('usageStats.chart.spend') : t('usageStats.chart.tokens');

  const chartData = useMemo(
    () =>
      (data ?? []).map((log) => ({
        [seriesKey]: type === ShowType.Spend ? log.totalSpend || 0 : log.totalTokens || 0,
        day: dayjs(log.day).format('MM-DD'),
      })),
    [data, type, seriesKey],
  );

  return (
    <Block gap={16} variant={'borderless'}>
      <Flexbox horizontal align={'center'} justify={'space-between'}>
        <Text fontSize={16} weight={500}>
          {t('usageStats.chart.title')}
        </Text>
        <Segmented
          value={type}
          options={[
            { label: t('usageStats.chart.spend'), value: ShowType.Spend },
            { label: t('usageStats.chart.tokens'), value: ShowType.Token },
          ]}
          onChange={(value) => setType(value as ShowType)}
        />
      </Flexbox>
      {isLoading ? (
        <Skeleton.Block height={280} />
      ) : (
        <BarChart
          categories={[seriesKey]}
          data={chartData}
          height={280}
          index={'day'}
          valueFormatter={(num: number) =>
            type === ShowType.Spend ? formatNumber(num, 2) : formatTokenNumber(num)
          }
        />
      )}
    </Block>
  );
});

export default UsageTrendChart;
