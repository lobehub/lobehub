import { cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import Statistic from '@/components/Statistic';
import StatisticCard from '@/components/StatisticCard';
import TitleWithPercentage from '@/components/StatisticCard/TitleWithPercentage';
import { useClientDataSWR } from '@/libs/swr';
import { topicService } from '@/services/topic';
import { formatIntergerNumber } from '@/utils/format';
import { lastMonth } from '@/utils/time';

import TotalCard from './ShareButton/TotalCard';

const TotalMessages = memo<{ inShare?: boolean; mobile?: boolean }>(({ inShare, mobile }) => {
  const { t } = useTranslation('auth');
  const { data, isLoading } = useClientDataSWR('stats-topics', async () => ({
    count: await topicService.countTopics(),
    prevCount: await topicService.countTopics({ endDate: lastMonth().format('YYYY-MM-DD') }),
  }));

  if (inShare)
    return (
      <TotalCard count={formatIntergerNumber(data?.prevCount) || '--'} title={t('stats.topics')} />
    );

  return (
    <StatisticCard
      highlight={mobile ? undefined : cssVar.gold}
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
  );
});

export default TotalMessages;
