'use client';

import { useWatchBroadcast } from '@lobechat/electron-client-ipc';
import { useCallback, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { isDesktop } from '@/const/version';
import { useElectronStore } from '@/store/electron';

import { getRouteMetadata } from '../helpers/routeMetadata';

/**
 * Hook to manage navigation history in Electron desktop app
 * Provides browser-like back/forward functionality
 */
export const useNavigationHistory = () => {
  const navigate = useNavigate();
  const location = useLocation();

  // Get store state and actions
  const isNavigatingHistory = useElectronStore((s) => s.isNavigatingHistory);
  const historyCurrentIndex = useElectronStore((s) => s.historyCurrentIndex);
  const historyEntries = useElectronStore((s) => s.historyEntries);
  const pushHistory = useElectronStore((s) => s.pushHistory);
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

  // Listen to route changes and update history
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

    // Push to history
    pushHistory({
      icon: metadata.icon,
      metadata: {
        timestamp: Date.now(),
      },
      title: metadata.title,
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

/**
 * Hook to initialize navigation history tracking
 * Should be called once in the app root to start tracking
 */
export const useInitNavigationHistory = () => {
  const location = useLocation();
  const pushHistory = useElectronStore((s) => s.pushHistory);
  const historyEntries = useElectronStore((s) => s.historyEntries);
  const isInitializedRef = useRef(false);

  // Initialize with current location on first mount
  useEffect(() => {
    if (!isDesktop) return;
    if (isInitializedRef.current) return;
    if (historyEntries.length > 0) return;

    const currentUrl = location.pathname + location.search;
    const metadata = getRouteMetadata(location.pathname);

    pushHistory({
      icon: metadata.icon,
      metadata: {
        timestamp: Date.now(),
      },
      title: metadata.title,
      url: currentUrl,
    });

    isInitializedRef.current = true;
  }, [location.pathname, location.search, pushHistory, historyEntries.length]);
};
