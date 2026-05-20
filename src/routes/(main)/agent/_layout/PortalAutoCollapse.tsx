'use client';

import { memo, useEffect, useRef } from 'react';

import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { useGlobalStore } from '@/store/global';

/**
 * Auto-collapse the left nav panel while Portal is open on the agent page.
 * Restores the previous state when Portal closes.
 */
const PortalAutoCollapse = memo(() => {
  const showPortal = useChatStore(chatPortalSelectors.showPortal);
  const savedShowLeftPanelRef = useRef<boolean | null>(null);

  useEffect(() => {
    const { status, toggleLeftPanel } = useGlobalStore.getState();

    if (showPortal) {
      // Remember the left-panel state only on the transition false→true
      if (savedShowLeftPanelRef.current === null) {
        savedShowLeftPanelRef.current = !!status.showLeftPanel;
        if (status.showLeftPanel) toggleLeftPanel(false);
      }
    } else if (savedShowLeftPanelRef.current !== null) {
      if (savedShowLeftPanelRef.current) toggleLeftPanel(true);
      savedShowLeftPanelRef.current = null;
    }
  }, [showPortal]);

  return null;
});

PortalAutoCollapse.displayName = 'PortalAutoCollapse';

export default PortalAutoCollapse;
