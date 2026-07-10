'use client';

import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';

import { isSameTabTarget, resolveTabScopeKey } from '@/features/Electron/titlebar/TabBar/scope';
import { useElectronStore } from '@/store/electron';

import { resolveTabNavigationAction } from './tabNavigation';

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
  const loadedScopeKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const currentUrl = location.pathname + location.search;
    const currentScopeKey = resolveTabScopeKey(currentUrl);

    if (loadedScopeKeyRef.current !== currentScopeKey) {
      loadTabs(currentUrl);
      loadedScopeKeyRef.current = currentScopeKey;
    }
    if (prevLocationRef.current === currentUrl) return;
    prevLocationRef.current = currentUrl;

    const { tabs, activeTabId } = useElectronStore.getState();
    const action = resolveTabNavigationAction({ activeTabId, currentUrl, tabs });

    switch (action.type) {
      case 'activate': {
        activateTab(action.id);
        break;
      }
      case 'add': {
        addTab(action.url);
        break;
      }
      case 'update': {
        updateTab(action.id, action.url);
        break;
      }
    }
  }, [location.pathname, location.search, activateTab, addTab, updateTab, loadTabs]);

  useEffect(() => {
    if (!currentRouteMeta || !currentRouteMetaUrl) return;

    const { activeTabId, tabs } = useElectronStore.getState();
    if (!activeTabId) return;
    const activeTab = tabs.find((t) => t.id === activeTabId);
    if (!activeTab) return;
    if (!isSameTabTarget(activeTab, currentRouteMetaUrl)) return;

    updateTabCache(activeTabId, currentRouteMeta);
  }, [currentRouteMeta, currentRouteMetaUrl, updateTabCache]);
};
