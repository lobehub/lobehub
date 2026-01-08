'use client';

import { useWatchBroadcast } from '@lobechat/electron-client-ipc';
import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';

import { useElectronStore } from '@/store/electron';

import { getRouteMetadata } from '../helpers/routeMetadata';

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

  // Track previous location to avoid duplicate entries
  const prevLocationRef = useRef<string | null>(null);

  // Calculate can go back/forward
  const canGoBack = historyCurrentIndex > 0;
  const canGoForward = historyCurrentIndex < historyEntries.length - 1;

  /**
   * Go back in history
   */
  const goBack = useCallback(() => {
    if (!canGoBackFn()) return;

    const targetEntry = storeGoBack();
    if (targetEntry) {
      navigate(targetEntry.url);
    }
  }, [canGoBackFn, storeGoBack, navigate]);

  /**
   * Go forward in history
   */
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

    prevLocationRef.current = currentUrl;
  }, [
    location.pathname,
    location.search,
    isNavigatingHistory,
    setIsNavigatingHistory,
    getCurrentEntry,
    pushHistory,
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
  }, [currentPageTitle, getCurrentEntry, replaceHistory, location.pathname]);

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
