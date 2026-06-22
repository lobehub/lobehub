import { Circle } from 'lucide-react';
import { matchRoutes, type RouteObject } from 'react-router';

import { mergeSearchParams } from '@/features/RouteMeta/params';
import {
  type DynamicRouteMeta,
  getRouteMetaFromHandle,
  type RouteMeta,
  type RouteMetaParams,
  type StaticRouteMeta,
} from '@/spa/router/routeMeta';

export interface MatchedRouteMeta {
  meta?: RouteMeta;
  params: RouteMetaParams;
  static: StaticRouteMeta;
}

export const matchRouteMeta = (routes: RouteObject[], url: string): MatchedRouteMeta => {
  const matches = matchRoutes(routes, url) ?? [];
  const params = mergeSearchParams(matches.at(-1)?.params ?? {}, url);

  for (let i = matches.length - 1; i >= 0; i -= 1) {
    const meta = getRouteMetaFromHandle(matches[i].route.handle);
    if (meta) {
      return { meta, params, static: { icon: meta.icon, titleKey: meta.titleKey } };
    }
  }

  return { params, static: {} };
};

const isMeaningful = (value: string | undefined): value is string =>
  typeof value === 'string' && value.length > 0;

export const guardedMergeCache = (
  prev: DynamicRouteMeta | undefined,
  next: DynamicRouteMeta | undefined,
): DynamicRouteMeta | undefined => {
  if (!next) return prev;

  const merged: DynamicRouteMeta = { ...prev };
  if (isMeaningful(next.title)) merged.title = next.title;
  if (isMeaningful(next.avatar)) merged.avatar = next.avatar;
  if (isMeaningful(next.backgroundColor)) merged.backgroundColor = next.backgroundColor;

  return Object.keys(merged).length > 0 ? merged : undefined;
};

export const FALLBACK_ICON = Circle;

export const pickMeaningful = (value: string | undefined): string | undefined =>
  isMeaningful(value) ? value : undefined;
