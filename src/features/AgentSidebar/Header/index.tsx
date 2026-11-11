'use client';

import { type PropsWithChildren } from 'react';

import SideBarHeaderLayout from '@/features/NavPanel/SideBarHeaderLayout';
import { useContactBackUrl } from '@/features/NavRail/useContactBackUrl';

import Agent from './Agent';
import Nav from './Nav';

const HeaderInfo = (_props: PropsWithChildren) => {
  const backTo = useContactBackUrl();

  return (
    <>
      <SideBarHeaderLayout backTo={backTo} left={<Agent />} />
      <Nav />
    </>
  );
};

export default HeaderInfo;
