'use client';

import { BRANDING_NAME } from '@lobechat/business-const';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMatches } from 'react-router-dom';

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
  const setCurrentRouteMeta = useElectronStore((s) => s.setCurrentRouteMeta);
  const matched = useMatchedRouteMeta();
  const [dynamic, setDynamic] = useState<DynamicRouteMeta>({});

  const handleResolve = useCallback(
    (resolved: DynamicRouteMeta) => {
      setDynamic(resolved);
      if (isDesktop) setCurrentRouteMeta(resolved);
    },
    [setCurrentRouteMeta],
  );

  const translate = t as unknown as Translate;
  const titleKey = matched?.meta.titleKey;
  const title = dynamic.title || (titleKey ? translate(titleKey) : '');

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
