'use client';

import SideBarHeaderLayout from '@/features/NavPanel/SideBarHeaderLayout';

import HeaderActions from './components/HeaderActions';
import Nav from './components/Nav';
import User from './components/User';

const Header = () => {
  return (
    <>
      <SideBarHeaderLayout left={<User />} right={<HeaderActions />} showBack={false} />
      <Nav />
    </>
  );
};

export default Header;
