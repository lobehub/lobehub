'use client';

import { type PropsWithChildren, memo } from 'react';

import SideBarHeaderLayout from '@/features/NavPanel/SideBarHeaderLayout';

import AddTopicButon from './AddTopicButon';
import Agent from './Agent';
import Nav from './Nav';

const HeaderInfo = memo<PropsWithChildren>(() => {
  return (
    <>
      <SideBarHeaderLayout left={<Agent />} right={<AddTopicButon />} />
      <Nav />
    </>
  );
});

export default HeaderInfo;
