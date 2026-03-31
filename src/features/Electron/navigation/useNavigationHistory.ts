'use client';

import { useWatchBroadcast } from '@lobechat/electron-client-ipc';
import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';

import { pluginRegistry } from '@/features/Electron/titlebar/RecentlyViewed/plugins';
import { useElectronStore } from '@/store/electron';

import { getCachedDataForReference } from './cachedData';
import { getRouteMetadata } from './routeMetadata';

/**
 * Hook to manage navigation history in Electron desktop app
 * Provides browser-like back/forward functionality
 */
export const useNavigationHistory = () => {
  const { t } = useTranslation('electron');
  const navigate = useNavigate();
  const location = useLocation();

  // Get store state and actions
  const isNavigatingHistory = useElectronStore((s) => s.isNavigatingHistory);
  const historyCurrentIndex = useElectronStore((s) => s.historyCurrentIndex);
  const historyEntries = useElectronStore((s) => s.historyEntries);
  const currentPageTitle = useElectronStore((s) => s.currentPageTitle);
  const pushHistory = useElectronStore((s) => s.pushHistory);
  const replaceHistory = useElectronStore((s) => s.replaceHistory);
  const setIsNavigatingHistory = useElectronStore((s) => s.setIsNavigatingHistory);
  const storeGoBack = useElectronStore((s) => s.goBack);
  const storeGoForward = useElectronStore((s) => s.goForward);
  const canGoBackFn = useElectronStore((s) => s.canGoBack);
  const canGoForwardFn = useElectronStore((s) => s.canGoForward);
  const getCurrentEntry = useElectronStore((s) => s.getCurrentEntry);
  const addRecentPage = useElectronStore((s) => s.addRecentPage);

  // Track previous location to avoid duplicate entries
  const prevLocationRef = useRef<string | null>(null);

  // Calculate can go back/forward
  const canGoBack = historyCurrentIndex > 0;
  const canGoForward = historyCurrentIndex < historyEntries.length - 1;

  const goBack = useCallback(() => {
    if (!canGoBackFn()) return;

    const targetEntry = storeGoBack();
    if (targetEntry) {
      navigate(targetEntry.url);
    }
  }, [canGoBackFn, storeGoBack, navigate]);

  const goForward = useCallback(() => {
    if (!canGoForwardFn()) return;

    const targetEntry = storeGoForward();
    if (targetEntry) {
      navigate(targetEntry.url);
    }
  }, [canGoForwardFn, storeGoForward, navigate]);

  // Listen to route changes and push history
  useEffect(() => {
    const currentUrl = location.pathname + location.search;

    // Skip if this is a back/forward navigation
    if (isNavigatingHistory) {
      setIsNavigatingHistory(false);
      prevLocationRef.current = currentUrl;
      return;
    }

    // Skip if same as previous location
    if (prevLocationRef.current === currentUrl) {
      return;
    }

    // Skip if same as current entry
    const currentEntry = getCurrentEntry();
    if (currentEntry?.url === currentUrl) {
      prevLocationRef.current = currentUrl;
      return;
    }

    // Get metadata for this route
    const metadata = getRouteMetadata(location.pathname);
    const presetTitle = t(metadata.titleKey as any) as string;

    // Push history with preset title (will be updated by PageTitle if useDynamicTitle)
    pushHistory({
      metadata: {
        timestamp: Date.now(),
      },
      title: presetTitle,
      url: currentUrl,
    });

    // Only add to recent pages if NOT a dynamic title route
    // Dynamic title routes will be added when the real title is available
    if (!metadata.useDynamicTitle) {
      // Parse URL into a page reference using plugins
      const reference = pluginRegistry.parseUrl(location.pathname, location.search);
      if (reference) {
        const cached = getCachedDataForReference(reference);
        addRecentPage(reference, cached);
      }
    }

    prevLocationRef.current = currentUrl;
  }, [
    location.pathname,
    location.search,
    isNavigatingHistory,
    setIsNavigatingHistory,
    getCurrentEntry,
    pushHistory,
    addRecentPage,
    t,
  ]);

  // Update current history entry title when PageTitle component updates
  useEffect(() => {
    if (!currentPageTitle) return;

    const currentEntry = getCurrentEntry();
    if (!currentEntry) return;

    // Check if current route supports dynamic title
    const metadata = getRouteMetadata(location.pathname);
    if (!metadata.useDynamicTitle) return;

    // Skip if title is already the same
    if (currentEntry.title === currentPageTitle) return;

    // Update the current history entry with the dynamic title
    replaceHistory({
      ...currentEntry,
      title: currentPageTitle,
    });

    // Add or update in recent pages (dynamic title routes are added here, not on route change)
    // Parse URL into a page reference using plugins
    const reference = pluginRegistry.parseUrl(location.pathname, location.search);
    if (reference) {
      // Get cached data with the dynamic title
      const cached = getCachedDataForReference(reference);
      // Override with the current page title if available
      const cachedWithTitle = cached
        ? { ...cached, title: currentPageTitle }
        : { title: currentPageTitle };
      addRecentPage(reference, cachedWithTitle);
    }
  }, [
    currentPageTitle,
    getCurrentEntry,
    replaceHistory,
    addRecentPage,
    location.pathname,
    location.search,
  ]);

  // Listen to broadcast events from main process (Electron menu)
  useWatchBroadcast('historyGoBack', () => {
    goBack();
  });

  useWatchBroadcast('historyGoForward', () => {
    goForward();
  });

  return {
    canGoBack,
    canGoForward,
    currentEntry: getCurrentEntry(),
    goBack,
    goForward,
    historyEntries,
    historyIndex: historyCurrentIndex,
  };
};
