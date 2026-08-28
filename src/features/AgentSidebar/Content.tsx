import SideBarLayout from '@/features/NavPanel/SideBarLayout';

import Body from './Body';
import Header from './Header';

const AgentSidebarContent = () => {
  return <SideBarLayout body={<Body />} header={<Header />} />;
};

export default AgentSidebarContent;
