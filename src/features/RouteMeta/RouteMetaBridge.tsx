'use client';

import { BRANDING_NAME } from '@lobechat/business-const';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useMatches } from 'react-router-dom';

import { isDesktop } from '@/const/version';
import {
  type DynamicRouteMeta,
  getRouteMetaFromHandle,
  type RouteMeta,
} from '@/spa/router/routeMeta';
import { useElectronStore } from '@/store/electron';

import DynamicMetaRunner from './DynamicMetaRunner';

interface MatchedRouteMeta {
  meta: RouteMeta;
  params: Record<string, string | undefined>;
  routeId: string;
}

interface DynamicRouteMetaState {
  matchKey: string | null;
  meta: DynamicRouteMeta;
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

const RouteMetaBridge = memo(() => {
  const { t } = useTranslation('electron');
  const location = useLocation();
  const setCurrentRouteMeta = useElectronStore((s) => s.setCurrentRouteMeta);
  const matched = useMatchedRouteMeta();
  const currentUrl = location.pathname + location.search;
  const matchedKey = matched ? `${matched.routeId}:${currentUrl}` : null;
  const [dynamic, setDynamic] = useState<DynamicRouteMetaState>({ matchKey: null, meta: {} });

  const handleResolve = useCallback(
    (resolved: DynamicRouteMeta) => {
      setDynamic({ matchKey: matchedKey, meta: resolved });
      if (isDesktop) setCurrentRouteMeta(resolved, currentUrl);
    },
    [currentUrl, matchedKey, setCurrentRouteMeta],
  );

  const translate = t as unknown as Translate;
  const titleKey = matched?.meta.titleKey;
  const currentDynamic = dynamic.matchKey === matchedKey ? dynamic.meta : {};
  const title = matched ? currentDynamic.title || (titleKey ? translate(titleKey) : '') : '';

  useEffect(() => {
    if (matchedKey) return;

    setDynamic({ matchKey: null, meta: {} });
    if (isDesktop) setCurrentRouteMeta(null);
  }, [matchedKey, setCurrentRouteMeta]);

  useEffect(() => {
    document.title = title ? `${title} · ${BRANDING_NAME}` : BRANDING_NAME;
  }, [title]);

  if (!matched) return null;

  return (
    <DynamicMetaRunner
      key={matched.routeId}
      params={matched.params}
      useDynamicMeta={matched.meta.useDynamicMeta}
      onResolve={handleResolve}
    />
  );
});

RouteMetaBridge.displayName = 'RouteMetaBridge';

export default RouteMetaBridge;
