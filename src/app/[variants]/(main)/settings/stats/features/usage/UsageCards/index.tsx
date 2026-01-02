import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import { type UsageChartProps } from '../../../types';
import ActiveModels from './ActiveModels';
import MonthSpend from './MonthSpend';
import TodaySpend from './TodaySpend';

const UsageCards = memo<UsageChartProps>(({ isLoading, data, groupBy }) => {
  return (
    <Flexbox gap={16} horizontal>
      <TodaySpend data={data} isLoading={isLoading} />
      <MonthSpend data={data} isLoading={isLoading} />
      <ActiveModels data={data} groupBy={groupBy} isLoading={isLoading} />
    </Flexbox>
  );
});

export default UsageCards;
