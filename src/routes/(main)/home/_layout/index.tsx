import { Flexbox } from '@lobehub/ui';
import { Activity, type FC, type ReactNode, useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';

import HomeAgentIdSync from './HomeAgentIdSync';
import RecentHydration from './RecentHydration';
import Sidebar from './Sidebar';
import { styles } from './style';

interface LayoutProps {
  children?: ReactNode;
}

const Layout: FC<LayoutProps> = ({ children }) => {
  const { pathname } = useLocation();
  const isHomeRoute = pathname === '/';
  const [hasActivated, setHasActivated] = useState(isHomeRoute);
  const content = children ?? <Outlet />;

  useEffect(() => {
    if (isHomeRoute) setHasActivated(true);
  }, [isHomeRoute]);

  if (!hasActivated) return null;

  return (
    <Activity mode={isHomeRoute ? 'visible' : 'hidden'} name="DesktopHomeLayout">
      <Flexbox className={styles.absoluteContainer} height={'100%'} width={'100%'}>
        <Sidebar />
        <Flexbox className={styles.content} flex={1} height={'100%'}>
          {content}
        </Flexbox>

        <HomeAgentIdSync />
        <RecentHydration />
      </Flexbox>
    </Activity>
  );
};

export default Layout;
