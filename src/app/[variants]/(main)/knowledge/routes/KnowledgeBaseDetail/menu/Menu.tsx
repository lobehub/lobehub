'use client';

import { memo } from 'react';
import { Flexbox } from 'react-layout-kit';

import Head from './Head';
import MenuItems from './MenuItems';

const Menu = memo<{ id: string }>(({ id }) => {
  return (
    <Flexbox gap={16} height={'100%'} paddingInline={12} style={{ paddingTop: 12 }}>
      <Head id={id} />
      <MenuItems />
    </Flexbox>
  );
});

Menu.displayName = 'Menu';

export default Menu;
