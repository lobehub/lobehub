'use client';

import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';

import { normalizeTabUrl } from '@/features/Electron/titlebar/TabBar/url';
import { useElectronStore } from '@/store/electron';

export const useTabNavigation = () => {
  const location = useLocation();

  const activateTab = useElectronStore((s) => s.activateTab);
  const addTab = useElectronStore((s) => s.addTab);
  const updateTab = useElectronStore((s) => s.updateTab);
  const updateTabCache = useElectronStore((s) => s.updateTabCache);
  const loadTabs = useElectronStore((s) => s.loadTabs);
  const currentRouteMeta = useElectronStore((s) => s.currentRouteMeta);
  const currentRouteMetaUrl = useElectronStore((s) => s.currentRouteMetaUrl);

  const prevLocationRef = useRef<string | null>(null);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (!loadedRef.current) {
      loadTabs();
      loadedRef.current = true;
    }
  }, [loadTabs]);

  useEffect(() => {
    const currentUrl = location.pathname + location.search;

    if (prevLocationRef.current === currentUrl) return;
    prevLocationRef.current = currentUrl;

    const id = normalizeTabUrl(currentUrl);
    const { tabs, activeTabId } = useElectronStore.getState();

    const existing = tabs.find((t) => t.id === id);
    if (existing) {
      if (existing.id !== activeTabId) activateTab(existing.id);
      return;
    }

    if (activeTabId && tabs.some((t) => t.id === activeTabId)) {
      updateTab(activeTabId, currentUrl);
    } else {
      // First launch (or stale activeTabId): make the current page visible as a tab,
      // so the tab bar and its "+" entry are always discoverable.
      addTab(currentUrl);
    }
  }, [location.pathname, location.search, activateTab, addTab, updateTab]);

  useEffect(() => {
    if (!currentRouteMeta || !currentRouteMetaUrl) return;

    const { activeTabId } = useElectronStore.getState();
    if (!activeTabId) return;
    if (activeTabId !== normalizeTabUrl(currentRouteMetaUrl)) return;

    updateTabCache(activeTabId, currentRouteMeta);
  }, [currentRouteMeta, currentRouteMetaUrl, updateTabCache]);
};
