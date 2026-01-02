'use client';

import { Flexbox, Grid } from '@lobehub/ui';
import { type FC, memo } from 'react';

import { type ItemCardProps } from './ItemCard';

interface AboutListProps {
  ItemRender: FC<ItemCardProps>;
  grid?: boolean;
  items: ItemCardProps[];
}

const AboutList = memo<AboutListProps>(({ grid, items, ItemRender }) => {
  const content = items.map((item) => <ItemRender key={item.value} {...item} />);

  if (!grid) return <Flexbox gap={8}>{content}</Flexbox>;

  return (
    <Grid gap={8} maxItemWidth={160} rows={5} width={'100%'}>
      {content}
    </Grid>
  );
});

export default AboutList;
