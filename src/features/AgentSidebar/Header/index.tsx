'use client';

import { type PropsWithChildren } from 'react';

import { useBackOrigin } from '@/features/NavPanel/backOrigin';
import SideBarHeaderLayout from '@/features/NavPanel/SideBarHeaderLayout';

import Agent from './Agent';
import Nav from './Nav';

const HeaderInfo = (_props: PropsWithChildren) => {
  const origin = useBackOrigin();

  return (
    <>
      <SideBarHeaderLayout backEscape={!!origin} backTo={origin ?? '/'} left={<Agent />} />
      <Nav />
    </>
  );
};

export default HeaderInfo;
