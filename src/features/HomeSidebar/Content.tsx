import { memo } from 'react';

import SideBarLayout from '@/features/NavPanel/SideBarLayout';

import Body from './Body';
import { AgentModalProvider } from './Body/Agent/ModalProvider';
import Header from './Header';

const HomeSidebarContent = memo(() => {
  return (
    <AgentModalProvider>
      <SideBarLayout body={<Body />} header={<Header />} />
    </AgentModalProvider>
  );
});

HomeSidebarContent.displayName = 'HomeSidebarContent';

export default HomeSidebarContent;
