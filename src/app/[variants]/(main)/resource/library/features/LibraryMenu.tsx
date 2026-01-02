'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import FileTree from '@/features/ResourceManager/components/Tree';

import Head from '../_layout/Header/LibraryHead';

const Menu = memo<{ id: string }>(({ id }) => {
  return (
    <Flexbox gap={16} height={'100%'} style={{ paddingTop: 12 }}>
      <Flexbox paddingInline={12}>
        <Head id={id} />
      </Flexbox>
      <FileTree />
    </Flexbox>
  );
});

Menu.displayName = 'Menu';

export default Menu;
