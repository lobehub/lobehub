'use client';

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { type RouteObject } from 'react-router';

import { desktopRoutes } from '@/spa/router/desktopRouter.config';
import { type DynamicRouteMeta, type ResolvedRouteMeta } from '@/spa/router/routeMeta';
import { useElectronStore } from '@/store/electron';

import { FALLBACK_ICON, matchRouteMeta, pickMeaningful } from '../resolveRouteMeta';
import { type TabItem } from '../types';
import { normalizeTabUrl } from '../url';

export interface ResolvedTab {
  isActive: boolean;
  meta: ResolvedRouteMeta;
  tab: TabItem;
}

interface UseResolvedTabsResult {
  activeTabId: string | null;
  tabs: ResolvedTab[];
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

export const resolveTab = (
  routes: RouteObject[],
  tab: TabItem,
  isActive: boolean,
  t: Translate,
  liveDynamic?: DynamicRouteMeta | null,
  liveDynamicTabId?: string | null,
): ResolvedTab => {
  const staticMeta = matchRouteMeta(routes, tab.url).static;

  const live = isActive && liveDynamicTabId === tab.id ? liveDynamic : undefined;

  const title =
    pickMeaningful(live?.title) ??
    pickMeaningful(tab.cached?.title) ??
    (staticMeta.titleKey ? t(staticMeta.titleKey, { ns: 'electron' }) : undefined) ??
    t('navigation.lobehub', { ns: 'electron' });

  const avatar = pickMeaningful(live?.avatar) ?? pickMeaningful(tab.cached?.avatar);
  const backgroundColor =
    pickMeaningful(live?.backgroundColor) ?? pickMeaningful(tab.cached?.backgroundColor);

  return {
    isActive,
    meta: {
      avatar,
      backgroundColor,
      icon: staticMeta.icon ?? FALLBACK_ICON,
      title,
    },
    tab,
  };
};

export const useResolvedTabs = (): UseResolvedTabsResult => {
  const { t } = useTranslation('electron');

  const tabRefs = useElectronStore((s) => s.tabs);
  const activeTabId = useElectronStore((s) => s.activeTabId);
  const currentRouteMeta = useElectronStore((s) => s.currentRouteMeta);
  const currentRouteMetaUrl = useElectronStore((s) => s.currentRouteMetaUrl);

  const translate = t as unknown as Translate;
  const currentRouteMetaTabId = currentRouteMetaUrl ? normalizeTabUrl(currentRouteMetaUrl) : null;

  const tabs = useMemo(
    () =>
      tabRefs.map((tab) =>
        resolveTab(
          desktopRoutes,
          tab,
          tab.id === activeTabId,
          translate,
          currentRouteMeta,
          currentRouteMetaTabId,
        ),
      ),
    [tabRefs, activeTabId, currentRouteMeta, currentRouteMetaTabId, translate],
  );

  return { activeTabId, tabs };
};
