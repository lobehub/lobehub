import { memo } from 'react';

import SideBarLayout from '@/features/NavPanel/SideBarLayout';

import Body from './Body';
import { AgentModalProvider } from './Body/Agent/ModalProvider';
import Footer from './Footer';
import Header from './Header';

const Sidebar = memo(() => {
  return (
    <AgentModalProvider>
      <SideBarLayout body={<Body />} footer={<Footer />} header={<Header />} />
    </AgentModalProvider>
  );
});

export default Sidebar;
