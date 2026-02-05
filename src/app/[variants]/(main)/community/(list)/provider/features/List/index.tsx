'use client';

import { Grid } from '@lobehub/ui';
import { memo } from 'react';

import type {DiscoverProviderItem} from '@/types/discover';

import ProviderEmpty from '../../../../features/ProviderEmpty';
import Item from './Item';

export interface ProvoderListProps {
  data?: DiscoverProviderItem[];
  rows?: number;
}

const ProvoderList = memo<ProvoderListProps>(({ data = [], rows = 3 }) => {
  if (data.length === 0) return <ProviderEmpty />;

  return (
    <Grid rows={rows} width={'100%'}>
      {data.map((item, index) => (
        <Item key={index} {...item} />
      ))}
    </Grid>
  );
});

export default ProvoderList;
