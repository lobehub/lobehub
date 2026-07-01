'use client';

import { BarChart } from '@lobehub/charts';
import { Block, Flexbox, Skeleton, Text } from '@lobehub/ui';
import { Segmented } from '@lobehub/ui/base-ui';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { type AgentUsageBucket } from '@/types/usage/usageRecord';
import { formatNumber, formatTokenNumber } from '@/utils/format';

enum ShowType {
  Spend = 'spend',
  Token = 'token',
}

// 输入 (dark) / 输出 (medium) / 缓存写入 (light) — blue shades matching the design.
const COLORS = ['#1668dc', '#4096ff', '#91caff'];

interface UsageTrendChartProps {
  buckets?: AgentUsageBucket[];
  isLoading?: boolean;
}

const UsageTrendChart = memo<UsageTrendChartProps>(({ buckets, isLoading }) => {
  const { t } = useTranslation('spend');
  const [type, setType] = useState<ShowType>(ShowType.Spend);

  const inputKey = t('usageStats.chart.input');
  const outputKey = t('usageStats.chart.output');
  const cacheWriteKey = t('usageStats.chart.cacheWrite');
  const categories = [inputKey, outputKey, cacheWriteKey];

  const chartData = useMemo(
    () =>
      (buckets ?? []).map((b) => ({
        [cacheWriteKey]: type === ShowType.Spend ? b.cacheWriteCost : b.cacheWriteTokens,
        [inputKey]: type === ShowType.Spend ? b.inputCost : b.inputTokens,
        [outputKey]: type === ShowType.Spend ? b.outputCost : b.outputTokens,
        label: b.label,
      })),
    [buckets, type, inputKey, outputKey, cacheWriteKey],
  );

  return (
    <Block gap={16} variant={'borderless'}>
      <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
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
        <Skeleton.Block height={320} />
      ) : (
        <BarChart
          showLegend
          stack
          categories={categories}
          colors={COLORS}
          data={chartData}
          height={320}
          index={'label'}
          valueFormatter={(num: number) =>
            type === ShowType.Spend ? `$${formatNumber(num, 2)}` : formatTokenNumber(num)
          }
        />
      )}
    </Block>
  );
});

export default UsageTrendChart;
