import { memo } from 'react';

import SideBarLayout from '@/features/NavPanel/SideBarLayout';

import Header from './Header';

const MemorySidebarContent = memo(() => <SideBarLayout header={<Header />} />);

MemorySidebarContent.displayName = 'MemorySidebarContent';

export default MemorySidebarContent;
