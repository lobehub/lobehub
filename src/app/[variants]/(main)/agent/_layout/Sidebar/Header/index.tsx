'use client';

import { type PropsWithChildren, memo } from 'react';

import SideBarHeaderLayout from '@/features/NavPanel/SideBarHeaderLayout';

import Agent from './Agent';
import Nav from './Nav';

const HeaderInfo = memo<PropsWithChildren>(() => {
  return (
    <>
      <SideBarHeaderLayout left={<Agent />} />
      <Nav />
    </>
  );
});

export default HeaderInfo;
