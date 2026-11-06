'use client';

import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useLocation } from 'react-router';

import { isDesktop } from '@/const/version';
import { selectActiveTabUrl } from '@/features/Electron/shell/activeTabUrl';
import { useElectronStore } from '@/store/electron';

import { readableRoutePath } from './routePathDisplay';

const styles = stylex.create({
  path: {
    overflow: 'hidden',
    display: 'block',
    maxWidth: '100%',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '11px',
    color: cssVar.colorTextTertiary,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
});

const RoutePathWidget = memo(() => {
  const { pathname } = useLocation();
  const activeTabUrl = useElectronStore(selectActiveTabUrl);

  // The DevDock renders inside the root router, which Electron freezes at the boot
  // url; the page actually on screen belongs to the active tab's per-tab router.
  const path = readableRoutePath((isDesktop && activeTabUrl) || pathname);

  return (
    <span {...stylex.props(styles.path)} title={path}>
      {path}
    </span>
  );
});

RoutePathWidget.displayName = 'DevDockRoutePathWidget';

export default RoutePathWidget;
