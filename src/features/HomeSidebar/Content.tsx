import { memo } from 'react';

import SideBarLayout from '@/features/NavPanel/SideBarLayout';
import Body from '@/routes/(main)/home/_layout/Body';
import { AgentModalProvider } from '@/routes/(main)/home/_layout/Body/Agent/ModalProvider';
import Header from '@/routes/(main)/home/_layout/Header';

const HomeSidebarContent = memo(() => {
  return (
    <AgentModalProvider>
      <SideBarLayout body={<Body />} header={<Header />} />
    </AgentModalProvider>
  );
});

HomeSidebarContent.displayName = 'HomeSidebarContent';

export default HomeSidebarContent;
