import { memo } from 'react';

import SideBarLayout from '@/features/NavPanel/SideBarLayout';

import Body from './Body';
import Header from './Header';

const SidebarContent = memo(() => {
  return <SideBarLayout body={<Body />} header={<Header />} />;
});

export default SidebarContent;
