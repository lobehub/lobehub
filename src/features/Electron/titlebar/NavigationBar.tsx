'use client';

import { useWatchBroadcast } from '@lobechat/electron-client-ipc';
import { ActionIcon, createStaticStyles, Flexbox, Popover, Tooltip } from '@lobehub/ui';
import { ArrowLeft, ArrowRight, Clock } from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import ToggleLeftPanelButton from '@/features/NavPanel/ToggleLeftPanelButton';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { electronSystemService } from '@/services/electron/system';
import { useElectronStore } from '@/store/electron';
import { useGlobalStore } from '@/store/global';
import type { GlobalState } from '@/store/global/initialState';
import { systemStatusSelectors } from '@/store/global/selectors';
import { getHomeStoreState } from '@/store/home';
import { electronStylish } from '@/styles/electron';
import { getPlatform, isMacOS } from '@/utils/platform';

import { useNavigationHistory } from '../navigation/useNavigationHistory';
import { getMacTrafficLightPadding } from './layout';
import RecentlyViewed from './RecentlyViewed';
import { useTrayMenuSync } from './TrayMenu/useTrayMenuSync';
import WindowsAppMenu from './WindowsAppMenu';

const isMac = isMacOS();
const isWindows = getPlatform() === 'Windows';
const COLLAPSED_NAVIGATION_BAR_WIDTH = 150;
const MAC_COLLAPSED_NAVIGATION_BAR_WIDTH = 116;

// A persistent titlebar toggle must not share the sidebar toggle's id, or it
// would create a duplicate DOM id and get caught by NavPanelDraggable's hover CSS.
const NAV_TOGGLE_ID = 'titlebar_toggle_left_panel_button';

const navPanelSelector = (s: GlobalState) => {
  const showLeftPanel = systemStatusSelectors.showLeftPanel(s);
  if (!showLeftPanel) return 0;
  return systemStatusSelectors.leftPanelWidth(s);
};

const useNavPanelWidth = () => {
  return useGlobalStore(navPanelSelector);
};

const styles = createStaticStyles(({ css, cssVar }) => ({
  clock: css`
    &[data-popup-open] {
      border-radius: ${cssVar.borderRadiusSM};
      background-color: ${cssVar.colorFillTertiary};
    }
  `,
  root: css`
    transition: width 0.2s ${cssVar.motionEaseOut};

    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `,
}));

const NavigationBar = memo(() => {
  useTrayMenuSync();
  const { t } = useTranslation('electron');
  const navigate = useWorkspaceAwareNavigate();
  const { canGoBack, canGoForward, goBack, goForward } = useNavigationHistory();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [isWindowFullScreen, setIsWindowFullScreen] = useState(false);
  const activeRecentScope = useElectronStore((state) => state.activeRecentScope);

  const leftPanelWidth = useNavPanelWidth();

  useWatchBroadcast('windowFullscreenChanged', ({ isFullScreen }) => {
    if (isMac) setIsWindowFullScreen(isFullScreen);
  });

  useWatchBroadcast('openRecentlyViewed', () => setHistoryOpen(true));

  useWatchBroadcast('openAllAgents', () => {
    const homePath = activeRecentScope.type === 'workspace' ? `/${activeRecentScope.slug}` : '/';
    navigate(homePath, { escape: true });
    getHomeStoreState().openAllAgentsDrawer();
  });

  useEffect(() => {
    if (!isMac) return;

    let disposed = false;

    const syncFullScreenState = async () => {
      try {
        const isFullScreen = await electronSystemService.isWindowFullScreen();
        if (!disposed) setIsWindowFullScreen(isFullScreen);
      } catch {
        if (!disposed) setIsWindowFullScreen(false);
      }
    };

    void syncFullScreenState();

    return () => {
      disposed = true;
    };
  }, []);

  // Toggle history popover
  const toggleHistoryOpen = useCallback(() => {
    setHistoryOpen((prev) => !prev);
  }, []);

  // Listen for keyboard shortcut ⌘Y / Ctrl+Y
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isCmdOrCtrl = isMac ? event.metaKey : event.ctrlKey;
      if (isCmdOrCtrl && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        toggleHistoryOpen();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [toggleHistoryOpen]);

  // Tooltip content for the clock button
  const tooltipContent = t('navigation.recentView');

  const isLeftPanelVisible = leftPanelWidth > 0;
  const macTrafficLightPadding = getMacTrafficLightPadding(isMac, isWindowFullScreen);
  const collapsedWidth =
    (isMac ? MAC_COLLAPSED_NAVIGATION_BAR_WIDTH : COLLAPSED_NAVIGATION_BAR_WIDTH) +
    macTrafficLightPadding;
  const navigationWidth = isLeftPanelVisible
    ? Math.max(leftPanelWidth - 12, collapsedWidth)
    : collapsedWidth;

  return (
    <Flexbox
      horizontal
      align="center"
      className={styles.root}
      data-width={leftPanelWidth}
      gap={8}
      justify={isMac || isWindows ? 'space-between' : 'end'}
      style={{
        paddingLeft: macTrafficLightPadding,
        paddingRight: 8,
        // Expanded: span the sidebar width so the right group hugs its right edge.
        // Collapsed: keep a concrete width so the titlebar controls can animate.
        width: navigationWidth,
      }}
    >
      {/* macOS keeps the sidebar toggle here. Windows uses the app icon as the menu. */}
      {isMac && (
        <Flexbox horizontal align="center" className={electronStylish.nodrag}>
          <ToggleLeftPanelButton forceVisible id={NAV_TOGGLE_ID} size="small" />
        </Flexbox>
      )}
      {isWindows && <WindowsAppMenu />}
      <Flexbox horizontal align="center" className={electronStylish.nodrag} gap={2}>
        <ActionIcon disabled={!canGoBack} icon={ArrowLeft} size="small" onClick={goBack} />
        <ActionIcon disabled={!canGoForward} icon={ArrowRight} size="small" onClick={goForward} />
        <Popover
          content={<RecentlyViewed onClose={() => setHistoryOpen(false)} />}
          open={historyOpen}
          placement="bottomLeft"
          styles={{ content: { padding: 0 } }}
          trigger="click"
          onOpenChange={setHistoryOpen}
        >
          <div className={styles.clock}>
            <Tooltip open={historyOpen ? false : undefined} title={tooltipContent}>
              <ActionIcon icon={Clock} size="small" />
            </Tooltip>
          </div>
        </Popover>
      </Flexbox>
    </Flexbox>
  );
});

NavigationBar.displayName = 'NavigationBar';

export default NavigationBar;
