import { type BarChartProps } from '@lobehub/charts';
import { Segmented, Skeleton } from '@lobehub/ui';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { type UsageLog, type UsageRecordItem } from '@/types/usage/usageRecord';
import { formatNumber } from '@/utils/format';

import { type UsageChartProps, type UserDisplayResolver } from '../../types';
import { GroupBy } from '../../types';
import StatsFormGroup from '../components/StatsFormGroup';
import { UsageBarChart } from '../components/UsageBarChart';

const recordKey = (item: UsageRecordItem, groupBy: GroupBy): string => {
  if (groupBy === GroupBy.Model) return item.model;
  if (groupBy === GroupBy.Provider) return item.provider;
  return item.userId;
};

const categoryLabel = (
  key: string,
  groupBy: GroupBy,
  resolveUser?: UserDisplayResolver,
): string => {
  if (groupBy === GroupBy.User && resolveUser) return resolveUser(key).name;
  return key;
};

const groupByType = (
  data: UsageLog[],
  type: 'spend' | 'token',
  groupBy: GroupBy,
  resolveUser?: UserDisplayResolver,
): { categories: string[]; data: BarChartProps['data'] } => {
  if (!data || data?.length === 0) return { categories: [], data: [] };
  const cate: Map<string, number> = data.reduce((acc, log) => {
    if (log.records) {
      for (const item of log.records) {
        const key = recordKey(item, groupBy);
        if (key) acc.set(categoryLabel(key, groupBy, resolveUser), 0);
      }
    }
    return acc;
  }, new Map<string, number>());
  const categories: string[] = Array.from(cate.keys());
  const formattedData = data.map((log) => {
    const totalObj = {
      day: log.day,
      total: type === 'spend' ? log.totalSpend : log.totalTokens,
    };
    const todayCate = new Map<string, number>(cate);
    for (const item of log.records) {
      const value = type === 'spend' ? item.spend || 0 : item.totalTokens || 0;
      const key = categoryLabel(recordKey(item, groupBy), groupBy, resolveUser);
      let displayValue = (todayCate.get(key) || 0) + value;
      if (type === 'spend') {
        const formattedNum = formatNumber((todayCate.get(key) || 0) + value, 2);
        if (typeof formattedNum !== 'string') {
          displayValue = formattedNum;
        }
      }
      todayCate.set(key, displayValue);
    }
    return {
      ...totalObj,
      ...Object.fromEntries(todayCate.entries()),
    };
  });
  return {
    categories,
    data: formattedData,
  };
};

enum ShowType {
  Spend = 'spend',
  Token = 'token',
}

const UsageTrends = memo<UsageChartProps>(({ isLoading, data, groupBy, resolveUser }) => {
  const { t } = useTranslation('auth');

  const [type, setType] = useState<ShowType>(ShowType.Spend);

  const { categories: spendCate, data: spendData } = groupByType(
    data || [],
    'spend',
    groupBy || GroupBy.Model,
    resolveUser,
  );
  const { categories: tokenCate, data: tokenData } = groupByType(
    data || [],
    'token',
    groupBy || GroupBy.Model,
    resolveUser,
  );

  const charts =
    data &&
    (type === ShowType.Spend ? (
      <UsageBarChart
        categories={spendCate}
        data={spendData}
        index="day"
        showType="spend"
        stack={true}
      />
    ) : (
      <UsageBarChart
        categories={tokenCate}
        data={tokenData}
        index="day"
        showType="token"
        stack={true}
      />
    ));

  return (
    <StatsFormGroup
      extra={
        <Segmented
          value={type}
          options={[
            { label: t('usage.trends.spend'), value: ShowType.Spend },
            { label: t('usage.trends.tokens'), value: ShowType.Token },
          ]}
          onChange={(value) => setType(value as ShowType)}
        />
      }
    >
      {isLoading ? <Skeleton.Block height={280} /> : charts}
    </StatsFormGroup>
  );
});

export default UsageTrends;
