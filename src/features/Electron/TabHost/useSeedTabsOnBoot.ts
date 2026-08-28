'use client';

import { useEffect, useRef } from 'react';

import { useElectronStore } from '@/store/electron';

import { resolveBootAction } from './resolveBootAction';

// The main process appends `lng` to every renderer load (Browser.buildUrlWithLocale)
// and index.html consumes it before React mounts. It describes the window, not the
// route, so it must stay out of tab identity — otherwise a plain launch reads as a
// deep link into `/?lng=…`, matches no persisted tab, and seeds a duplicate one.
const readBootUrl = (): string => {
  const { hash, pathname, search } = window.location;

  const params = new URLSearchParams(search);
  if (!params.has('lng')) return `${pathname}${search}${hash}`;

  params.delete('lng');
  const query = params.toString();

  return `${pathname}${query ? `?${query}` : ''}${hash}`;
};

export const useSeedTabsOnBoot = () => {
  const seededRef = useRef(false);

  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;

    const bootUrl = readBootUrl();

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
