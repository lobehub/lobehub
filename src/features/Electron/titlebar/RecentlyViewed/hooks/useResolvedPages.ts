'use client';

import { useMemo } from 'react';

import { useElectronStore } from '@/store/electron';

import { pluginRegistry } from '../plugins';
import { type ResolvedPageData } from '../types';
import { usePluginContext } from './usePluginContext';

interface UseResolvedPagesResult {
  pinnedPages: ResolvedPageData[];
  recentPages: ResolvedPageData[];
}

/**
 * Hook to resolve page references into display data
 * Automatically filters out pages where data no longer exists
 */
export const useResolvedPages = (): UseResolvedPagesResult => {
  const ctx = usePluginContext();

  const pinnedRefs = useElectronStore((s) => s.pinnedPages);
  const recentRefs = useElectronStore((s) => s.recentPages);

  const pinnedPages = useMemo(() => pluginRegistry.resolveAll(pinnedRefs, ctx), [pinnedRefs, ctx]);

  const recentPages = useMemo(() => pluginRegistry.resolveAll(recentRefs, ctx), [recentRefs, ctx]);

  return {
    pinnedPages,
    recentPages,
  };
};
