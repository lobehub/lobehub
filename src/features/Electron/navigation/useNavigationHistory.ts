'use client';

import { useWatchBroadcast } from '@lobechat/electron-client-ipc';
import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';

import { matchRouteMeta } from '@/features/Electron/titlebar/TabBar/resolveRouteMeta';
import { normalizeTabUrl } from '@/features/Electron/titlebar/TabBar/url';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { desktopRoutes } from '@/spa/router/desktopRouter.config';
import { useElectronStore } from '@/store/electron';

export const useNavigationHistory = () => {
  const { t } = useTranslation('electron');
  const navigate = useWorkspaceAwareNavigate();
  const location = useLocation();

  const isNavigatingHistory = useElectronStore((s) => s.isNavigatingHistory);
  const historyCurrentIndex = useElectronStore((s) => s.historyCurrentIndex);
  const historyEntries = useElectronStore((s) => s.historyEntries);
  const currentRouteMeta = useElectronStore((s) => s.currentRouteMeta);
  const currentRouteMetaUrl = useElectronStore((s) => s.currentRouteMetaUrl);
  const pushHistory = useElectronStore((s) => s.pushHistory);
  const replaceHistory = useElectronStore((s) => s.replaceHistory);
  const setIsNavigatingHistory = useElectronStore((s) => s.setIsNavigatingHistory);
  const storeGoBack = useElectronStore((s) => s.goBack);
  const storeGoForward = useElectronStore((s) => s.goForward);
  const canGoBackFn = useElectronStore((s) => s.canGoBack);
  const canGoForwardFn = useElectronStore((s) => s.canGoForward);
  const getCurrentEntry = useElectronStore((s) => s.getCurrentEntry);
  const addRecentPage = useElectronStore((s) => s.addRecentPage);

  const prevLocationRef = useRef<string | null>(null);

  const canGoBack = historyCurrentIndex > 0;
  const canGoForward = historyCurrentIndex < historyEntries.length - 1;

  const goBack = useCallback(() => {
    if (!canGoBackFn()) return;

    const targetEntry = storeGoBack();
    if (targetEntry) navigate(targetEntry.url);
  }, [canGoBackFn, storeGoBack, navigate]);

  const goForward = useCallback(() => {
    if (!canGoForwardFn()) return;

    const targetEntry = storeGoForward();
    if (targetEntry) navigate(targetEntry.url);
  }, [canGoForwardFn, storeGoForward, navigate]);

  useEffect(() => {
    const currentUrl = location.pathname + location.search;

    if (isNavigatingHistory) {
      setIsNavigatingHistory(false);
      prevLocationRef.current = currentUrl;
      return;
    }

    if (prevLocationRef.current === currentUrl) return;

    const currentEntry = getCurrentEntry();
    if (currentEntry?.url === currentUrl) {
      prevLocationRef.current = currentUrl;
      return;
    }

    const staticMeta = matchRouteMeta(desktopRoutes, currentUrl).static;
    const presetTitle = staticMeta.titleKey
      ? (t(staticMeta.titleKey as never) as string)
      : (t('navigation.lobehub') as string);

    pushHistory({
      metadata: { timestamp: Date.now() },
      title: presetTitle,
      url: currentUrl,
    });

    addRecentPage(currentUrl);

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

  useEffect(() => {
    const dynamicTitle = currentRouteMeta?.title;
    if (!dynamicTitle || !currentRouteMetaUrl) return;

    const currentEntry = getCurrentEntry();
    if (!currentEntry) return;
    if (normalizeTabUrl(currentEntry.url) !== normalizeTabUrl(currentRouteMetaUrl)) return;
    if (currentEntry.title === dynamicTitle) return;

    replaceHistory({ ...currentEntry, title: dynamicTitle });
    addRecentPage(currentEntry.url, currentRouteMeta ?? undefined);
  }, [currentRouteMeta, currentRouteMetaUrl, getCurrentEntry, replaceHistory, addRecentPage]);

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
