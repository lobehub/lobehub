'use client';

import { Grid } from '@lobehub/ui';
import { memo } from 'react';

import { type DiscoverModelItem } from '@/types/discover';

import ModelEmpty from '../../../../features/ModelEmpty';
import Item from './Item';

interface ModelListProps {
  data?: DiscoverModelItem[];
  rows?: number;
}

const ModelList = memo<ModelListProps>(({ data = [], rows = 3 }) => {
  if (data.length === 0) return <ModelEmpty />;

  return (
    <Grid rows={rows} width={'100%'}>
      {data.map((item, index) => (
        <Item key={index} {...item} />
      ))}
    </Grid>
  );
});

export default ModelList;
