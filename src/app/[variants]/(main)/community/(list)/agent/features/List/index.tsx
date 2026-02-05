'use client';

import { Grid } from '@lobehub/ui';
import { memo } from 'react';

import type {DiscoverAssistantItem} from '@/types/discover';

import AssistantEmpty from '../../../../features/AssistantEmpty';
import Item from './Item';

export interface AssistantListProps {
  data?: DiscoverAssistantItem[];
  rows?: number;
}

const AssistantList = memo<AssistantListProps>(({ data = [], rows = 3 }) => {
  if (data.length === 0) return <AssistantEmpty />;

  return (
    <Grid rows={rows} width={'100%'}>
      {data.map((item, index) => (
        <Item key={index} {...item} />
      ))}
    </Grid>
  );
});

export default AssistantList;
