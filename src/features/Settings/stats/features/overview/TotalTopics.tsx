import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import Statistic from '@/components/Statistic';
import StatisticCard from '@/components/StatisticCard';
import TitleWithPercentage from '@/components/StatisticCard/TitleWithPercentage';
import { useClientDataSWR } from '@/libs/swr';
import { statsKeys } from '@/libs/swr/keys';
import { topicService } from '@/services/topic';
import { formatIntergerNumber } from '@/utils/format';
import { lastMonth } from '@/utils/time';

import TotalCard from './ShareButton/TotalCard';

const TotalMessages = memo<{ inShare?: boolean; mobile?: boolean }>(({ inShare }) => {
  const { t } = useTranslation('auth');
  const { data, isLoading, error, mutate } = useClientDataSWR(statsKeys.topics(), async () => ({
    count: await topicService.countTopics(),
    prevCount: await topicService.countTopics({ endDate: lastMonth().format('YYYY-MM-DD') }),
  }));

  if (inShare)
    return (
      <TotalCard count={formatIntergerNumber(data?.prevCount) || '--'} title={t('stats.topics')} />
    );

  return (
    <AsyncBoundary data={data} error={error} errorVariant={'metric'} onRetry={() => mutate()}>
      <StatisticCard
        loading={isLoading || !data}
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
