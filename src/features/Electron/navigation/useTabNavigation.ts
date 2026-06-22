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

    const normalized = normalizeTabUrl(currentUrl);
    const { tabs, activeTabId } = useElectronStore.getState();

    const activeTab = activeTabId ? tabs.find((t) => t.id === activeTabId) : null;
    if (activeTab && normalizeTabUrl(activeTab.url) === normalized) {
      // Keep the active tab's url in sync (e.g. query/hash variations that
      // normalize the same) without re-activating.
      if (activeTab.url !== currentUrl) updateTab(activeTab.id, currentUrl);
      return;
    }

    const existing = tabs.find((t) => normalizeTabUrl(t.url) === normalized);
    if (existing) {
      activateTab(existing.id);
      return;
    }

    if (activeTab) {
      updateTab(activeTab.id, currentUrl);
    } else {
      // First launch (or stale activeTabId): make the current page visible as a tab,
      // so the tab bar and its "+" entry are always discoverable.
      addTab(currentUrl);
    }
  }, [location.pathname, location.search, activateTab, addTab, updateTab]);

  useEffect(() => {
    if (!currentRouteMeta || !currentRouteMetaUrl) return;

    const { activeTabId, tabs } = useElectronStore.getState();
    if (!activeTabId) return;
    const activeTab = tabs.find((t) => t.id === activeTabId);
    if (!activeTab) return;
    if (normalizeTabUrl(activeTab.url) !== normalizeTabUrl(currentRouteMetaUrl)) return;

    updateTabCache(activeTabId, currentRouteMeta);
  }, [currentRouteMeta, currentRouteMetaUrl, updateTabCache]);
};
