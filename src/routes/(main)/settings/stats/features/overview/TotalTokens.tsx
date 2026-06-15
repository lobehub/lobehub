import dayjs from 'dayjs';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import Statistic from '@/components/Statistic';
import StatisticCard from '@/components/StatisticCard';
import TitleWithPercentage from '@/components/StatisticCard/TitleWithPercentage';
import { useClientDataSWR } from '@/libs/swr';
import { statsKeys } from '@/libs/swr/keys';
import { messageService } from '@/services/message';
import { formatShortenNumber } from '@/utils/format';
import { lastMonth } from '@/utils/time';

import { HeatmapType } from '../../types';
import TotalCard from './ShareButton/TotalCard';

/**
 * Cumulative token count. Derived from the daily token-heatmap series (same SWR
 * key as the heatmap, so the request is deduped) rather than a separate query:
 * `count` sums the whole window and `prevCount` sums up to the end of last month
 * so the card shows the same month-over-month delta as its siblings.
 */
const TotalTokens = memo<{ inShare?: boolean }>(({ inShare }) => {
  const { t } = useTranslation('auth');

  const { data, isLoading } = useClientDataSWR(statsKeys.heatmaps(HeatmapType.Tokens), () =>
    messageService.getTokenHeatmaps(),
  );

  const { count, prevCount } = useMemo(() => {
    if (!data?.length) return { count: 0, prevCount: 0 };

    const lastMonthEnd = lastMonth();
    let count = 0;
    let prevCount = 0;
    for (const item of data) {
      count += item.count;
      if (!dayjs(item.date).isAfter(lastMonthEnd)) prevCount += item.count;
    }
    return { count, prevCount };
  }, [data]);

  if (inShare)
    return (
      <TotalCard
        count={formatShortenNumber(prevCount) || '--'}
        title={t('stats.heatmapStats.totalTokens')}
      />
    );

  return (
    <StatisticCard
      loading={isLoading || !data}
      statistic={{
        description: (
          <Statistic title={t('date.prevMonth')} value={formatShortenNumber(prevCount) || '--'} />
        ),
        precision: 0,
        style: {
          fontWeight: 'bold',
        },
        value: formatShortenNumber(count) || '--',
      }}
      title={
        <TitleWithPercentage
          count={count}
          prvCount={prevCount}
          title={t('stats.heatmapStats.totalTokens')}
        />
      }
    />
  );
});

export default TotalTokens;
