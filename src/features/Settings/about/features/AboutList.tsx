'use client';

import { Flexbox, Grid } from '@lobehub/ui';
import { type FC } from 'react';
import { memo } from 'react';

import { type ItemCardProps } from './ItemCard';

interface AboutListProps {
  grid?: boolean;
  ItemRender: FC<ItemCardProps>;
  items: ItemCardProps[];
}

const AboutList = memo<AboutListProps>(({ grid, items, ItemRender }) => {
  const content = items.map((item) => <ItemRender key={item.value} {...item} />);

  // Link rows (Contact / Legal) read as one line of links rather than a stacked
  // list; wrap keeps them intact on narrow viewports.
  if (!grid)
    return (
      <Flexbox horizontal align={'center'} gap={24} wrap={'wrap'}>
        {content}
      </Flexbox>
    );

  return (
    <Grid gap={8} maxItemWidth={160} rows={5} width={'100%'}>
      {content}
    </Grid>
  );
});

export default AboutList;
