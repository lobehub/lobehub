import { Flexbox } from '@lobehub/ui';
import type { FC } from 'react';
import { Outlet } from 'react-router-dom';

import Sidebar from './Sidebar';
import { styles } from './style';
import TopicSidebar from './TopicSidebar';

const Layout: FC = () => {
  return (
    <>
      <Sidebar />
      <Flexbox horizontal className={styles.mainContainer} flex={1} height={'100%'}>
        <Flexbox className={styles.contentContainer} flex={1} height={'100%'}>
          <Outlet />
        </Flexbox>
        <TopicSidebar />
      </Flexbox>
    </>
  );
};

export default Layout;
