import { Flexbox } from '@lobehub/ui';
import { useTheme } from 'antd-style';
import { Activity, type FC, type ReactNode, useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';

import { useIsDark } from '@/hooks/useIsDark';

import HomeAgentIdSync from './HomeAgentIdSync';
import RecentHydration from './RecentHydration';
import Sidebar from './Sidebar';
import { styles } from './style';

interface LayoutProps {
  children?: ReactNode;
}

const Layout: FC<LayoutProps> = ({ children }) => {
  const isDarkMode = useIsDark();
  const theme = useTheme(); // Keep for colorBgContainerSecondary (not in cssVar)
  const { pathname } = useLocation();
  const isHomeRoute = pathname === '/';
  const [hasActivated, setHasActivated] = useState(isHomeRoute);
  const content = children ?? <Outlet />;

  useEffect(() => {
    if (isHomeRoute) setHasActivated(true);
  }, [isHomeRoute]);

  // CSS variable for dynamic background color (colorBgContainerSecondary is not in cssVar)
  const cssVariables = useMemo<Record<string, string>>(
    () => ({
      '--content-bg-secondary': theme.colorBgContainerSecondary,
    }),
    [theme.colorBgContainerSecondary],
  );

  if (!hasActivated) return null;

  // Keep the Home layout alive and render it offscreen when inactive.
  return (
    <Activity mode={isHomeRoute ? 'visible' : 'hidden'} name="DesktopHomeLayout">
      <Flexbox className={styles.absoluteContainer} height={'100%'} width={'100%'}>
        <Sidebar />
        <Flexbox
          className={isDarkMode ? styles.contentDark : styles.contentLight}
          flex={1}
          height={'100%'}
          style={cssVariables}
        >
          {content}
        </Flexbox>

        <HomeAgentIdSync />
        <RecentHydration />
      </Flexbox>
    </Activity>
  );
};

export default Layout;
