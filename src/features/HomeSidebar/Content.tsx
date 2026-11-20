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
        // The minimum height and flex layout keep the bottom spacer working.
        contentStyle={{
          display: 'flex',
          flexDirection: 'column',
          height: 'auto',
          minHeight: '100%',
        }}
      />
    </AgentModalProvider>
  );
};

export default HomeSidebarContent;
