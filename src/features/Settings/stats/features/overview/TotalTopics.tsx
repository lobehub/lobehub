import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import Statistic from '@/components/Statistic';
import StatisticCard from '@/components/StatisticCard';
import TitleWithPercentage from '@/components/StatisticCard/TitleWithPercentage';
import { statsActions, statsSelectors, useStatsStore } from '@/store/stats';
import { formatIntergerNumber } from '@/utils/format';

import TotalCard from './ShareButton/TotalCard';

const TotalMessages = memo<{ inShare?: boolean; mobile?: boolean }>(({ inShare }) => {
  const { t } = useTranslation('auth');
  const { error, revalidate } = statsActions.useFetchTotal('topics');
  const data = useStatsStore(statsSelectors.total('topics'));

  if (inShare)
    return (
      <TotalCard count={formatIntergerNumber(data?.prevCount) || '--'} title={t('stats.topics')} />
    );

  return (
    <AsyncBoundary data={data} error={error} errorVariant={'metric'} onRetry={() => revalidate()}>
      <StatisticCard
        loading={!data}
        statistic={{
          description: (
            <Statistic
              title={t('date.prevMonth')}
              value={formatIntergerNumber(data?.prevCount) || '--'}
            />
          ),
          precision: 0,
          value: data?.count || '--',
        }}
        title={
          <TitleWithPercentage
            count={data?.count}
            prvCount={data?.prevCount}
            title={t('stats.topics')}
          />
        }
      />
    </AsyncBoundary>
  );
});

export default TotalMessages;
