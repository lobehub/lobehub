'use client';

import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

import { pluginRegistry } from '@/features/Electron/titlebar/RecentlyViewed/plugins';
import { useElectronStore } from '@/store/electron';

import { getCachedDataForReference } from './cachedData';

/**
 * Hook to sync route changes with tab state
 * - Does NOT auto-create tabs (tabs are created explicitly via context menu / double-click)
 * - When navigating within an active tab, updates that tab's reference to track current location
 * - Updates tab cache when dynamic title changes
 */
export const useTabNavigation = () => {
  const location = useLocation();

  const activateTab = useElectronStore((s) => s.activateTab);
  const updateTab = useElectronStore((s) => s.updateTab);
  const updateTabCache = useElectronStore((s) => s.updateTabCache);
  const loadTabs = useElectronStore((s) => s.loadTabs);
  const currentPageTitle = useElectronStore((s) => s.currentPageTitle);

  const prevLocationRef = useRef<string | null>(null);
  const loadedRef = useRef(false);

  // Load tabs from localStorage on mount
  useEffect(() => {
    if (!loadedRef.current) {
      loadTabs();
      loadedRef.current = true;
    }
  }, [loadTabs]);

  // Sync route changes to tabs (no auto-creation)
  useEffect(() => {
    const currentUrl = location.pathname + location.search;

    if (prevLocationRef.current === currentUrl) return;
    prevLocationRef.current = currentUrl;

    const reference = pluginRegistry.parseUrl(location.pathname, location.search);
    if (!reference) return;

    const { tabs, activeTabId } = useElectronStore.getState();

    // If this exact page is already a tab, activate it
    const existing = tabs.find((t) => t.id === reference.id);
    if (existing) {
      if (existing.id !== activeTabId) {
        activateTab(existing.id);
      }
      return;
    }

    // If there's an active tab, update it to track the new location
    if (activeTabId) {
      const cached = getCachedDataForReference(reference);
      updateTab(activeTabId, reference, cached);
    }
  }, [location.pathname, location.search, activateTab, updateTab]);

  // Update tab cache when dynamic title changes
  useEffect(() => {
    if (!currentPageTitle) return;

    const { tabs, activeTabId } = useElectronStore.getState();
    if (!activeTabId) return;

    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab) return;

    if (tab.cached?.title === currentPageTitle) return;

    updateTabCache(activeTabId, { title: currentPageTitle });
  }, [currentPageTitle, updateTabCache]);
};
