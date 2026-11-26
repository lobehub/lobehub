import SideBarLayout from '@/features/NavPanel/SideBarLayout';

import Body from './Body';
import { AgentModalProvider } from './Body/Agent/ModalProvider';
import Header from './Header';

const HomeSidebarContent = () => {
  return (
    <AgentModalProvider>
      <SideBarLayout
        body={<Body />}
        header={<Header />}
        // Let ScrollArea observe accordion height changes and update its overflow fade.
        contentStyle={{ height: 'auto' }}
      />
    </AgentModalProvider>
  );
};

export default HomeSidebarContent;
