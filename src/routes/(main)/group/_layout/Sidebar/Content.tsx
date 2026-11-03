import SideBarLayout from '@/features/NavPanel/SideBarLayout';

import Body from './Body';
import Header from './Header';

const GroupSidebarContent = () => {
  return <SideBarLayout body={<Body />} header={<Header />} />;
};

export default GroupSidebarContent;
