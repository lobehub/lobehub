'use client';

import { ActionIcon, Flexbox, Popover, Tooltip } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { ArrowLeft, ArrowRight, Clock } from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import ToggleLeftPanelButton from '@/features/NavPanel/ToggleLeftPanelButton';
import { useGlobalStore } from '@/store/global';
import type { GlobalState } from '@/store/global/initialState';
import { systemStatusSelectors } from '@/store/global/selectors';
import { electronStylish } from '@/styles/electron';
import { isMacOS } from '@/utils/platform';

import { useNavigationHistory } from '../navigation/useNavigationHistory';
import { TITLE_BAR_HORIZONTAL_PADDING } from './layout';
import RecentlyViewed from './RecentlyViewed';

const isMac = isMacOS();

// Reserve space for macOS traffic lights so the toggle sits to their right.
// Matches the popup TitleBar's MAC_TRAFFIC_LIGHT_WIDTH (80) minus the titlebar's
// own horizontal padding, which already offsets the left edge.
const MAC_TRAFFIC_LIGHT_WIDTH = 80;
const macTrafficLightPadding = MAC_TRAFFIC_LIGHT_WIDTH - TITLE_BAR_HORIZONTAL_PADDING;

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
}));

const NavigationBar = memo(() => {
  const { t } = useTranslation('electron');
  const { canGoBack, canGoForward, goBack, goForward } = useNavigationHistory();
  const [historyOpen, setHistoryOpen] = useState(false);

  const leftPanelWidth = useNavPanelWidth();

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

  return (
    <Flexbox
      horizontal
      align="center"
      data-width={leftPanelWidth}
      gap={8}
      justify={isMac ? 'space-between' : 'end'}
      style={{
        paddingLeft: isMac ? macTrafficLightPadding : 0,
        paddingRight: 8,
        // Expanded: span the sidebar width so the right group hugs its right edge.
        // Collapsed (macOS): shrink to content so the controls cluster at the left edge.
        width: isLeftPanelVisible ? `${leftPanelWidth - 12}px` : isMac ? 'auto' : '150px',
        transition: !isLeftPanelVisible ? 'width 0.2s' : 'none',
      }}
    >
      {/* The persistent panel toggle is macOS-only; other platforms keep the
          in-page toggles, so the titlebar shows just the navigation controls. */}
      {isMac && (
        <Flexbox horizontal align="center" className={electronStylish.nodrag}>
          <ToggleLeftPanelButton forceVisible id={NAV_TOGGLE_ID} size="small" />
        </Flexbox>
      )}
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
