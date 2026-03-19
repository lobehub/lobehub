import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import { useClientDataSWR } from '@/libs/swr';
import { usageService } from '@/services/usage';

import { type UsageChartProps } from '../../../types';
import ActiveModels from './ActiveModels';
import MonthSpend from './MonthSpend';
import TodaySpend from './TodaySpend';

const UsageCards = memo<UsageChartProps>(({ isLoading, data, groupBy }) => {
  const { data: quota } = useClientDataSWR('usage-quota', () => usageService.checkQuota());

  return (
    <Flexbox horizontal gap={16}>
      <TodaySpend data={data} isLoading={isLoading} quota={quota} />
      <MonthSpend data={data} isLoading={isLoading} quota={quota} />
      <ActiveModels data={data} groupBy={groupBy} isLoading={isLoading} />
    </Flexbox>
  );
});

export default UsageCards;
