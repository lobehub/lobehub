import { Flexbox } from '@lobehub/ui';
import { useTheme } from 'antd-style';
import { Activity, type FC, type ReactNode, useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation } from 'react-router';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
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
  const activeSlug = useActiveWorkspaceSlug();
  const isHomeRoute =
    pathname === '/' ||
    (!!activeSlug && (pathname === `/${activeSlug}` || pathname === `/${activeSlug}/`));
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

  // Register the Home sidebar even on a cold deep link. Routes without a
  // dedicated sidebar (for example /tasks) intentionally use the Home entry.
  if (!hasActivated) return <Sidebar />;

  // Keep the Home layout alive and render it offscreen when inactive. The
  // Portal stays outside Activity so its registry entry remains available to
  // routes that intentionally reuse Home navigation (for example /tasks).
  return (
    <>
      <Sidebar />
      <Activity mode={isHomeRoute ? 'visible' : 'hidden'} name="DesktopHomeLayout">
        {/* `position: absolute; inset: 0` keeps overlaying the outlet when Activity is hidden,
          because Activity preserves state but doesn't visually hide the DOM. Force-hide here. */}
        <Flexbox
          className={styles.absoluteContainer}
          height={'100%'}
          style={isHomeRoute ? undefined : { display: 'none' }}
          width={'100%'}
        >
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
    </>
  );
};

export default Layout;
