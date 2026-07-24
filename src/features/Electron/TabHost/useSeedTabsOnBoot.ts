'use client';

import { useEffect, useRef } from 'react';

import { useElectronStore } from '@/store/electron';

import { resolveBootAction } from './resolveBootAction';

export const useSeedTabsOnBoot = () => {
  const seededRef = useRef(false);

  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;

    const bootUrl = window.location.pathname + window.location.search;

    const { loadTabs } = useElectronStore.getState();
    loadTabs(bootUrl);

    const { tabs, activeTabId, activateTab, addTab } = useElectronStore.getState();
    const action = resolveBootAction(tabs, activeTabId, bootUrl);

    switch (action.type) {
      case 'activate': {
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
