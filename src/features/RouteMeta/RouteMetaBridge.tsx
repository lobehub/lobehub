'use client';

import { BRANDING_NAME } from '@lobechat/business-const';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { isDesktop } from '@/const/version';
import { useMatches } from '@/libs/router/navigation';
import {
  type DynamicRouteMeta,
  getRouteMetaFromHandle,
  type RouteMeta,
  type RouteMetaParams,
} from '@/spa/router/routeMeta';
import { useElectronStore } from '@/store/electron';
import { routerSelectors, useRouterStore } from '@/store/router';

import DynamicMetaRunner from './DynamicMetaRunner';
import { mergeSearchParams } from './params';

interface MatchedRouteMeta {
  meta: RouteMeta;
  params: RouteMetaParams;
  routeId: string;
}

interface DynamicRouteMetaState {
  meta: DynamicRouteMeta;
  routeId: string | null;
}

const useMatchedRouteMeta = (): MatchedRouteMeta | null => {
  const matches = useMatches();

  return useMemo(() => {
    for (let i = matches.length - 1; i >= 0; i -= 1) {
      const match = matches[i];
      const meta = getRouteMetaFromHandle(match.handle);
      if (meta) {
        return { meta, params: match.params, routeId: match.id };
      }
    }
    return null;
  }, [matches]);
};

type Translate = (key: string) => string;

const translateTitleKey = (titleKey: string | undefined, translate: Translate) => {
  if (!titleKey) return '';

  const title = translate(titleKey);
  return title === titleKey ? '' : title;
};

const RouteMetaBridge = memo(() => {
  const { t } = useTranslation('electron');
  const currentUrl = useRouterStore(routerSelectors.url);
  const search = useRouterStore(routerSelectors.search);
  const setCurrentRouteMeta = useElectronStore((s) => s.setCurrentRouteMeta);
  const matched = useMatchedRouteMeta();
  const matchedRouteId = matched?.routeId ?? null;
  const DynamicMeta = matched?.meta.DynamicMeta;
  const [dynamic, setDynamic] = useState<DynamicRouteMetaState>({ meta: {}, routeId: null });

  const publishRouteMeta = useCallback(
    (resolved: DynamicRouteMeta, url: string) => setCurrentRouteMeta(resolved, url),
    [setCurrentRouteMeta],
  );

  const handleResolve = useCallback(
    (resolved: DynamicRouteMeta) => {
      setDynamic({ meta: resolved, routeId: matchedRouteId });
      if (isDesktop) publishRouteMeta(resolved, currentUrl);
    },
    [currentUrl, matchedRouteId, publishRouteMeta],
  );

  const translate = t as unknown as Translate;
  const titleKey = matched?.meta.titleKey;
  const routeMetaParams = useMemo(
    () => (matched ? mergeSearchParams(matched.params, search) : {}),
    [matched, search],
  );
  // Keep the previously resolved meta while navigating within the same route family
  // (e.g. switching topics) so the title doesn't briefly fall back to the static label.
  const currentDynamic = matched && dynamic.routeId === matched.routeId ? dynamic.meta : {};
  const title = matched ? currentDynamic.title || translateTitleKey(titleKey, translate) : '';

  useEffect(() => {
    if (DynamicMeta) return;

    setDynamic({ meta: {}, routeId: matchedRouteId });
    if (isDesktop) {
      if (matchedRouteId) publishRouteMeta({}, currentUrl);
      else setCurrentRouteMeta(null);
    }
  }, [DynamicMeta, matchedRouteId, currentUrl, publishRouteMeta, setCurrentRouteMeta]);

  useEffect(() => {
    document.title = title ? `${title} · ${BRANDING_NAME}` : BRANDING_NAME;
  }, [title]);

  if (!matched || !DynamicMeta) return null;

  return (
    <DynamicMetaRunner
      DynamicMeta={DynamicMeta}
      key={matched.routeId}
      params={routeMetaParams}
      onResolve={handleResolve}
    />
  );
});

RouteMetaBridge.displayName = 'RouteMetaBridge';

export default RouteMetaBridge;
