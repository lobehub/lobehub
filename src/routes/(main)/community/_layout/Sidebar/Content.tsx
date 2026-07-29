import { memo } from 'react';

import SideBarLayout from '@/features/NavPanel/SideBarLayout';

import Header from './Header';

const Content = memo(() => {
  return <SideBarLayout header={<Header />} />;
});

Content.displayName = 'DiscoverSidebarContent';

export default Content;
