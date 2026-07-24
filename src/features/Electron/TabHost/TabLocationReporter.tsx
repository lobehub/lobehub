'use client';

import { use, useEffect } from 'react';
import { useLocation } from 'react-router';

import { useElectronStore } from '@/store/electron';

import { TabIdContext } from './TabIdContext';

const TabLocationReporter = () => {
  const tabId = use(TabIdContext);
  const location = useLocation();
  const updateTab = useElectronStore((s) => s.updateTab);

  useEffect(() => {
    if (!tabId) return;
    // `<Activity mode="hidden">` tears down effects in hidden trees, so only the
    // active tab reaches here; the active-id check is belt-and-braces.
    if (useElectronStore.getState().activeTabId !== tabId) return;

    updateTab(tabId, location.pathname + location.search);
  }, [tabId, location.pathname, location.search, updateTab]);

  return null;
};

export default TabLocationReporter;
