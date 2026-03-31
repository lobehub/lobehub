'use client';

import { Grid } from '@lobehub/ui';
import { memo } from 'react';

import { type DiscoverSkillItem } from '@/types/discover';

import SkillEmpty from '../../../../features/SkillEmpty';
import Item from './Item';

interface SkillListProps {
  data?: DiscoverSkillItem[];
  rows?: number;
}

const SkillList = memo<SkillListProps>(({ data = [], rows = 3 }) => {
  if (data.length === 0) return <SkillEmpty />;

  return (
    <Grid rows={rows} width={'100%'}>
      {data.map((item, index) => (
        <Item key={index} {...item} />
      ))}
    </Grid>
  );
});

export default SkillList;
