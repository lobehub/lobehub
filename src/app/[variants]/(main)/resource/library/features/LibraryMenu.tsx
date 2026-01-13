'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import LibraryHierarchy from '@/features/ResourceManager/components/LibraryHierarchy';

import Head from '../_layout/Header/LibraryHead';

const Menu = memo<{ id: string }>(({ id }) => {
  return (
    <Flexbox gap={16} height={'100%'} style={{ paddingTop: 12 }}>
      <Flexbox paddingInline={12}>
        <Head id={id} />
      </Flexbox>
      <LibraryHierarchy />
    </Flexbox>
  );
});

Menu.displayName = 'Menu';

export default Menu;
