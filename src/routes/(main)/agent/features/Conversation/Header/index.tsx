'use client';

import { isDesktop } from '@lobechat/const';
import { Flexbox } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { memo } from 'react';

import NavHeader from '@/features/NavHeader';

import HeaderActions from './HeaderActions';
import NotebookButton from './NotebookButton';
import ShareButton from './ShareButton';
import Tags from './Tags';
import WorkingDirectory from './WorkingDirectory';

const Header = memo(() => {
  return (
    <NavHeader
      left={
        <Flexbox style={{ backgroundColor: cssVar.colorBgContainer }}>
          <Tags />
        </Flexbox>
      }
      right={
        <Flexbox horizontal align={'center'} style={{ backgroundColor: cssVar.colorBgContainer }}>
          {isDesktop && <WorkingDirectory />}
          <NotebookButton />
          <ShareButton />
          <HeaderActions />
        </Flexbox>
      }
    />
  );
});

export default Header;
