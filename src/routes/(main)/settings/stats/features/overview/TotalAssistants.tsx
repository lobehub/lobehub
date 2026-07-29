import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import Statistic from '@/components/Statistic';
import StatisticCard from '@/components/StatisticCard';
import TitleWithPercentage from '@/components/StatisticCard/TitleWithPercentage';
import { useClientDataSWR } from '@/libs/swr';
import { statsKeys } from '@/libs/swr/keys';
import { agentService } from '@/services/agent';
import { formatIntergerNumber } from '@/utils/format';
import { lastMonth } from '@/utils/time';

import TotalCard from './ShareButton/TotalCard';

const TotalMessages = memo<{ inShare?: boolean; mobile?: boolean }>(({ inShare }) => {
  const { t } = useTranslation('auth');
  const { data, isLoading, error, mutate } = useClientDataSWR(statsKeys.agents(), async () => ({
    count: await agentService.countAgents(),
    prevCount: await agentService.countAgents({ endDate: lastMonth().format('YYYY-MM-DD') }),
  }));

  if (inShare)
    return (
      <TotalCard
        count={formatIntergerNumber(data?.prevCount) || '--'}
        title={t('stats.assistants')}
      />
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
            title={t('stats.assistants')}
          />
        }
      />
    </AsyncBoundary>
  );
});

export default TotalMessages;
