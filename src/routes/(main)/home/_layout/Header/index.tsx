'use client';

import { memo } from 'react';

import SideBarHeaderLayout from '@/features/NavPanel/SideBarHeaderLayout';

import AddButton from './components/AddButton';
import Nav from './components/Nav';
import User from './components/User';

const Header = memo(() => {
  return (
    <>
      <SideBarHeaderLayout left={<User />} right={<AddButton />} showBack={false} />
      <Nav />
    </>
  );
});

export default Header;
