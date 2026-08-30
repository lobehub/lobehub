'use client';

import isEqual from 'fast-deep-equal';

import { useCacheScope } from '@/libs/swr/useCacheScope';

import { useProjectionStore } from '../../store';
import { useProjectionViewHydration } from '../../views/hook';
import { briefNewsViewContract } from './contracts';
import { selectBriefNews, selectBriefNewsIndex } from './selectors';

export const useBriefNews = (day: string) => {
  useProjectionViewHydration(briefNewsViewContract, { day }, Boolean(day));
  const scope = useCacheScope();
  return useProjectionStore((state) => {
    const projectionScope = state.scopes[scope];
    const index = selectBriefNewsIndex(projectionScope, day);
    const items = selectBriefNews(projectionScope, day);
    return index && items
      ? { day: index.day, hasEarlier: index.hasEarlier, news: items }
      : undefined;
  }, isEqual);
};
