'use client';

import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';
import { useLocation } from 'react-router';

import { isDesktop } from '@/const/version';
import { selectActiveTabUrl } from '@/features/Electron/shell/activeTabUrl';
import { useElectronStore } from '@/store/electron';

const styles = createStaticStyles(({ css }) => ({
  path: css`
    overflow: hidden;
    display: block;

    max-width: 100%;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 11px;
    color: ${cssVar.colorTextTertiary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

const RoutePathWidget = memo(() => {
  const { pathname } = useLocation();
  const activeTabUrl = useElectronStore(selectActiveTabUrl);

  // The DevDock renders inside the root router, which Electron freezes at the boot
  // url; the page actually on screen belongs to the active tab's per-tab router.
  const path = (isDesktop && activeTabUrl) || pathname;

  return (
    <span className={styles.path} title={path}>
      {path}
    </span>
  );
});

RoutePathWidget.displayName = 'DevDockRoutePathWidget';

export default RoutePathWidget;
