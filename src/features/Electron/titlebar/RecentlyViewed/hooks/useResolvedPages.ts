'use client';

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { desktopRoutes } from '@/spa/router/desktopRouter.config';
import { useElectronStore } from '@/store/electron';

import { type ResolvedTab, resolveTab } from '../../TabBar/hooks/useResolvedTabs';

interface UseResolvedPagesResult {
  pinnedPages: ResolvedTab[];
  recentPages: ResolvedTab[];
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

export const useResolvedPages = (): UseResolvedPagesResult => {
  const { t } = useTranslation('electron');

  const pinnedRefs = useElectronStore((s) => s.pinnedPages);
  const recentRefs = useElectronStore((s) => s.recentPages);

  const translate = t as unknown as Translate;

  const pinnedPages = useMemo(
    () => pinnedRefs.map((tab) => resolveTab(desktopRoutes, tab, false, translate)),
    [pinnedRefs, translate],
  );

  const recentPages = useMemo(
    () => recentRefs.map((tab) => resolveTab(desktopRoutes, tab, false, translate)),
    [recentRefs, translate],
  );

  return { pinnedPages, recentPages };
};
