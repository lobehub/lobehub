'use client';

import { ActionIcon, Flexbox, Tooltip } from '@lobehub/ui';
import { Popover } from 'antd';
import { ChevronLeft, ChevronRight, Clock } from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';

import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { electronStylish } from '@/styles/electron';
import { isMacOS } from '@/utils/platform';

import { useNavigationHistory } from '../hooks/useNavigationHistory';
import RecentlyViewed from './RecentlyViewed';

const isMac = isMacOS();

/**
 * Hook to observe NavPanel width in real-time using ResizeObserver
 */
const useNavPanelWidth = () => {
  // Get stored width as initial value
  const storedWidth = useGlobalStore(systemStatusSelectors.leftPanelWidth);
  const [liveWidth, setLiveWidth] = useState(storedWidth);

  useEffect(() => {
    // Find the NavPanel element (DraggablePanel renders with data-panel-id)
    const navPanelElement = document.querySelector('[class*="draggable-panel"]') as HTMLElement;

    if (!navPanelElement) {
      // Fallback to stored width if element not found
      setLiveWidth(storedWidth);
      return;
    }

    // Create ResizeObserver to track live width changes
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentRect.width;
        if (width > 0) {
          setLiveWidth(width);
        }
      }
    });

    resizeObserver.observe(navPanelElement);

    // Set initial width
    const initialWidth = navPanelElement.getBoundingClientRect().width;
    if (initialWidth > 0) {
      setLiveWidth(initialWidth);
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, [storedWidth]);

  return liveWidth;
};

const NavigationBar = memo(() => {
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
  const tooltipContent = (
    <Flexbox align="center" gap={8} horizontal>
      <span>Recently viewed</span>
      <Flexbox gap={2} horizontal style={{ opacity: 0.6 }}>
        <kbd>{isMac ? '⌘' : 'Ctrl'}</kbd>
        <kbd>Y</kbd>
      </Flexbox>
    </Flexbox>
  );

  return (
    <Flexbox
      align="center"
      className={electronStylish.nodrag}
      data-width={leftPanelWidth}
      horizontal
      justify="end"
      style={{ width: `${leftPanelWidth - 12}px` }}
    >
      <Flexbox align="center" gap={2} horizontal>
        <ActionIcon disabled={!canGoBack} icon={ChevronLeft} onClick={goBack} size="small" />
        <ActionIcon disabled={!canGoForward} icon={ChevronRight} onClick={goForward} size="small" />
        <Popover
          arrow={false}
          content={<RecentlyViewed onClose={() => setHistoryOpen(false)} />}
          onOpenChange={setHistoryOpen}
          open={historyOpen}
          placement="bottomLeft"
          styles={{ container: { padding: 0 } }}
          trigger="click"
        >
          <div>
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
