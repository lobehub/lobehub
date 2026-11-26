'use client';

import { type PropsWithChildren } from 'react';

import { useBackButtonProps } from '@/features/NavPanel/backOrigin';
import SideBarHeaderLayout from '@/features/NavPanel/SideBarHeaderLayout';

import Agent from './Agent';
import Nav from './Nav';

const HeaderInfo = (_props: PropsWithChildren) => {
  const back = useBackButtonProps();

  return (
    <>
      <SideBarHeaderLayout {...back} left={<Agent />} />
      <Nav />
    </>
  );
};

export default HeaderInfo;
