import { Flexbox } from '@lobehub/ui';
import { useTheme } from 'antd-style';
import { type FC, type ReactNode } from 'react';
import { Activity, useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

import { useIsDark } from '@/hooks/useIsDark';
import { useHomeStore } from '@/store/home';

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
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const isHomeRoute = pathname === '/';
  const [hasActivated, setHasActivated] = useState(isHomeRoute);
  const setNavigate = useHomeStore((s) => s.setNavigate);
  const content = children ?? <Outlet />;

  useEffect(() => {
    setNavigate(navigate);
  }, [navigate, setNavigate]);

  useEffect(() => {
    if (isHomeRoute) setHasActivated(true);
  }, [isHomeRoute]);

  // CSS 变量用于动态背景色（colorBgContainerSecondary 不在 cssVar 中）
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
