'use client';

import SideBarHeaderLayout from '@/features/NavPanel/SideBarHeaderLayout';

import InboxButton from './components/InboxButton';
import Nav from './components/Nav';
import User from './components/User';

const Header = () => {
  return (
    <>
      <SideBarHeaderLayout left={<User />} right={<InboxButton />} showBack={false} />
      <Nav />
    </>
  );
};

export default Header;
