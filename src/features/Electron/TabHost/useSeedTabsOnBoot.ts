'use client';

import { useEffect, useRef } from 'react';

import { useElectronStore } from '@/store/electron';

import { resolveBootAction } from './resolveBootAction';

export const useSeedTabsOnBoot = () => {
  const seededRef = useRef(false);

  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;

    const bootUrl = window.location.pathname + window.location.search + window.location.hash;

    const { loadTabs } = useElectronStore.getState();
    loadTabs(bootUrl);

    const { tabs, activeTabId, activateTab, addTab, updateTab } = useElectronStore.getState();
    const action = resolveBootAction(tabs, activeTabId, bootUrl);

    switch (action.type) {
      case 'activate': {
        if (action.url) updateTab(action.id, action.url);
        activateTab(action.id);
        break;
      }
      case 'add': {
        addTab(action.url);
        break;
      }
    }
  }, []);
};
