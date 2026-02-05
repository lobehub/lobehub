'use client';

import { ActionIcon, Flexbox, Popover, Tooltip } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { ArrowLeft, ArrowRight, Clock } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { electronStylish } from '@/styles/electron';
import { isMacOS } from '@/utils/platform';

import { useNavigationHistory } from '../navigation/useNavigationHistory';
import RecentlyViewed from './RecentlyViewed';
import { loadAllRecentlyViewedPlugins } from './RecentlyViewed/plugins';

const isMac = isMacOS();

const useNavPanelWidth = () => {
  return useGlobalStore(systemStatusSelectors.leftPanelWidth);
};

const styles = createStaticStyles(({ css, cssVar }) => ({
  clock: css`
    &[data-popup-open] {
      border-radius: ${cssVar.borderRadiusSM};
      background-color: ${cssVar.colorFillTertiary};
    }
  `,
}));

const useLoadAllRecentlyViewedPlugins = () => {
  const registerRef = useRef(false);

  if (!registerRef.current) {
    loadAllRecentlyViewedPlugins();
    registerRef.current = true;
  }
};
const NavigationBar = memo(() => {
  useLoadAllRecentlyViewedPlugins();

  const { t } = useTranslation('electron');
  const { canGoBack, canGoForward, goBack, goForward } = useNavigationHistory();
  const [historyOpen, setHistoryOpen] = useState(false);
  // Use ResizeObserver for real-time width updates during resize
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

  return (
    <Flexbox
      horizontal
      align="center"
      data-width={leftPanelWidth}
      justify="end"
      style={{ width: `${leftPanelWidth - 12}px` }}
    >
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
