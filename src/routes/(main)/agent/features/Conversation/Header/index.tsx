'use client';

import { Flexbox } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { memo } from 'react';

import NavHeader from '@/features/NavHeader';

import HeaderActions from './HeaderActions';
import ShareButton from './ShareButton';
import Tags from './Tags';
import WorkingPanelToggle from './WorkingPanelToggle';

const Header = memo(() => {
  return (
    <NavHeader
      left={
        <Flexbox
          horizontal
          align={'center'}
          gap={4}
          style={{ backgroundColor: cssVar.colorBgContainer }}
        >
          <Tags />
          <HeaderActions />
        </Flexbox>
      }
      right={
        <Flexbox horizontal align={'center'} style={{ backgroundColor: cssVar.colorBgContainer }}>
          <ShareButton />
          <WorkingPanelToggle />
        </Flexbox>
      }
    />
  );
});

export default Header;
