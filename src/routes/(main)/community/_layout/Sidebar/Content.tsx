import InstalledNav from '@/features/Marketplace/InstalledNav';
import SideBarLayout from '@/features/NavPanel/SideBarLayout';

import Header from './Header';

const Content = () => {
  return <SideBarLayout body={<InstalledNav />} header={<Header />} />;
};

export default Content;
