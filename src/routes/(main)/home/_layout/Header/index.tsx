'use client';

import { memo } from 'react';

import SideBarHeaderLayout from '@/features/NavPanel/SideBarHeaderLayout';

import Nav from './components/Nav';
import User from './components/User';

const Header = memo(() => {
  return (
    <>
      <SideBarHeaderLayout left={<User />} showBack={false} />
      <Nav />
    </>
  );
});

export default Header;
