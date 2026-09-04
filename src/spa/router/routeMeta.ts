import type { LucideIcon } from 'lucide-react';
import type { ComponentType } from 'react';

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

export interface RouteHandle {
  meta?: RouteMeta;
}

export interface ResolvedRouteMeta {
  avatar?: string;
  backgroundColor?: string;
  icon?: LucideIcon;
  title: string;
}

/**
 * For a route whose surface is mounted outside the router outlet, or that
 * paints fast enough that any placeholder is pure flicker. Declared rather than
 * omitted: an absent `Skeleton` falls through to `RouteSegmentSkeleton`'s
 * path heuristics, which would guess a generic surface shape instead.
 */
export const NoRouteSkeleton = () => null;

export const routeMeta = (meta: RouteMeta): RouteMeta => meta;

export const getRouteMetaFromHandle = (handle: unknown): RouteMeta | undefined => {
  if (!handle || typeof handle !== 'object') return undefined;
  return (handle as RouteHandle).meta;
};
