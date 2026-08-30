import type { LucideIcon } from 'lucide-react';
import type { ComponentType } from 'react';

import type { ProjectionPrefetch } from '@/projection/views/prefetch';

export interface StaticRouteMeta {
  icon?: LucideIcon;
  /** Optional Electron tab label when it should differ from the document title. */
  tabTitleKey?: string;
  titleKey?: string;
}

export interface DynamicRouteMeta {
  avatar?: string;
  backgroundColor?: string;
  title?: string;
}

export type RouteMetaParams = Record<string, string | undefined>;

export interface DynamicRouteMetaProps {
  onResolve: (meta: DynamicRouteMeta) => void;
  params: RouteMetaParams;
}

export type RouteSkeletonChrome = 'page' | 'body';

export interface RouteSkeletonProps {
  chrome?: RouteSkeletonChrome;
}

export interface RouteMeta extends StaticRouteMeta {
  DynamicMeta?: ComponentType<DynamicRouteMetaProps>;
  Skeleton?: ComponentType<RouteSkeletonProps>;
}

/**
 * First-screen Projection data this route needs, declared next to the route so
 * a new surface opts in where it is defined instead of in a central list that
 * silently rots. Boot resolves the landing route and warms these before the
 * segment mounts; anything absent here still hydrates on mount as usual.
 */
export type RoutePrefetch = (params: RouteMetaParams) => ProjectionPrefetch[];

export interface RouteHandle {
  meta?: RouteMeta;
  prefetch?: RoutePrefetch;
}

export interface ResolvedRouteMeta {
  avatar?: string;
  backgroundColor?: string;
  icon?: LucideIcon;
  title: string;
}

export const routeMeta = (meta: RouteMeta): RouteMeta => meta;

export const getRouteMetaFromHandle = (handle: unknown): RouteMeta | undefined => {
  if (!handle || typeof handle !== 'object') return undefined;
  return (handle as RouteHandle).meta;
};

export const getRoutePrefetchFromHandle = (handle: unknown): RoutePrefetch | undefined => {
  if (!handle || typeof handle !== 'object') return undefined;
  return (handle as RouteHandle).prefetch;
};
