'use client';

import { Grid } from '@lobehub/ui';
import { memo } from 'react';

import { type DiscoverMcpItem } from '@/types/discover';

import McpEmpty from '../../../../features/McpEmpty';
import Item from './Item';

interface McpListProps {
  data?: DiscoverMcpItem[];
  rows?: number;
}

const McpList = memo<McpListProps>(({ data = [], rows = 3 }) => {
  if (data.length === 0) return <McpEmpty />;

  return (
    <Grid rows={rows} width={'100%'}>
      {data.map((item, index) => (
        <Item key={index} {...item} />
      ))}
    </Grid>
  );
});

export default McpList;
