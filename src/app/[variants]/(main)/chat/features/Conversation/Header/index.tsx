'use client';

import { Flexbox } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { memo } from 'react';

import NavHeader from '@/features/NavHeader';

import WideScreenButton from '../../../../../../../features/WideScreenContainer/WideScreenButton';
import NotebookButton from './NotebookButton';
import ShareButton from './ShareButton';
import Tags from './Tags';

const Header = memo(() => {
  return (
    <NavHeader
      left={
        <Flexbox style={{ backgroundColor: cssVar.colorBgContainer }}>
          <Tags />
        </Flexbox>
      }
      right={
        <Flexbox horizontal style={{ backgroundColor: cssVar.colorBgContainer }}>
          <WideScreenButton />
          <NotebookButton />
          <ShareButton />
        </Flexbox>
      }
    />
  );
});

export default Header;
