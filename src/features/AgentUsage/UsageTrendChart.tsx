'use client';

import { BarChart, ChartTooltipFrame, ChartTooltipRow } from '@lobehub/charts';
import { Block, Flexbox, Skeleton, Text } from '@lobehub/ui';
import { Segmented } from '@lobehub/ui/base-ui';
import { Divider } from 'antd';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { type AgentUsageBucket } from '@/types/usage/usageRecord';
import { formatNumber, formatTokenNumber } from '@/utils/format';

enum ShowType {
  Spend = 'spend',
  Token = 'token',
}

// Uncached input (dark) / cached input / output / cache write (light).
const COLORS = ['#1668dc', '#1677ff', '#4096ff', '#91caff'];

interface UsageTrendChartProps {
  buckets?: AgentUsageBucket[];
  isLoading?: boolean;
}

const UsageTrendChart = memo<UsageTrendChartProps>(({ buckets, isLoading }) => {
  const { t } = useTranslation('spend');
  const [type, setType] = useState<ShowType>(ShowType.Spend);

  const inputKey = t('usageStats.chart.input');
  const cachedInputKey = t('usageStats.chart.cachedInput');
  const outputKey = t('usageStats.chart.output');
  const cacheWriteKey = t('usageStats.chart.cacheWrite');

  const chartData = useMemo(
    () =>
      (buckets ?? []).map((b) => ({
        [cacheWriteKey]: type === ShowType.Spend ? b.cacheWriteCost : b.cacheWriteTokens,
        [cachedInputKey]: type === ShowType.Spend ? b.cachedInputCost : b.cachedInputTokens,
        [inputKey]: type === ShowType.Spend ? b.inputCost : b.inputTokens,
        [outputKey]: type === ShowType.Spend ? b.outputCost : b.outputTokens,
        label: b.label,
      })),
    [buckets, type, inputKey, cachedInputKey, outputKey, cacheWriteKey],
  );

  const series = useMemo(
    () =>
      [inputKey, cachedInputKey, outputKey, cacheWriteKey]
        .map((key, index) => ({ color: COLORS[index], key }))
        .filter(({ key }) => chartData.some((item) => Number(item[key]) > 0)),
    [cacheWriteKey, cachedInputKey, chartData, inputKey, outputKey],
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
          categories={series.map(({ key }) => key)}
          colors={series.map(({ color }) => color)}
          data={chartData}
          height={320}
          index={'label'}
          customTooltip={({ active, label, payload }) => {
            if (!active || !payload) return null;

            const visibleItems = payload.filter(
              ({ value }) => typeof value === 'number' && value > 0,
            );

            return (
              <ChartTooltipFrame>
                <Flexbox paddingBlock={8} paddingInline={16}>
                  <Text as={'p'} style={{ margin: 0 }}>
                    {label}
                  </Text>
                </Flexbox>
                {visibleItems.length > 0 && (
                  <>
                    <Divider style={{ margin: 0 }} />
                    <Flexbox gap={4} paddingBlock={8} paddingInline={16}>
                      {visibleItems.map(({ color, name, value }) => (
                        <ChartTooltipRow
                          color={color ?? '#1668dc'}
                          key={String(name)}
                          name={String(name ?? '')}
                          value={
                            type === ShowType.Spend
                              ? `$${formatNumber(value as number, 2)}`
                              : formatTokenNumber(value as number)
                          }
                        />
                      ))}
                    </Flexbox>
                  </>
                )}
              </ChartTooltipFrame>
            );
          }}
          valueFormatter={(num: number) =>
            type === ShowType.Spend ? `$${formatNumber(num, 2)}` : formatTokenNumber(num)
          }
        />
      )}
    </Block>
  );
});

export default UsageTrendChart;
