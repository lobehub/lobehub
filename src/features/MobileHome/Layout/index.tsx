import { Outlet } from 'react-router';

import { AgentSearchProvider } from './AgentSearchContext';
import MobileLayout from './MobileLayout';

const Layout = () => (
  <AgentSearchProvider>
    <MobileLayout>
      <Outlet />
    </MobileLayout>
  </AgentSearchProvider>
);

export default Layout;
