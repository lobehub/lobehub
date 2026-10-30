import type { LucideIcon } from 'lucide-react';
import type { ComponentType } from 'react';

export interface StaticRouteMeta {
  icon?: LucideIcon;
  /** Optional Electron tab label when it should differ from the document title. */
  tabTitleKey?: string;
  titleKey?: string;
}

export type RouteAvatarKind = 'workspace';

export interface DynamicRouteMeta {
  /**
   * `null` means the entity loaded and has no avatar, which clears a cached
   * one; `undefined` means it is not known yet, which keeps the cache.
   */
  avatar?: string | null;
  /**
   * The entity whose avatar this is, when its fallback differs from the
   * initials one. A workspace draws the bauhaus mark seeded from its title.
   */
  avatarKind?: RouteAvatarKind;
  /**
   * Name a generated avatar is seeded from, for an entity that draws one when it
   * has no image of its own (a project). Unset keeps the initials fallback.
   */
  avatarSeed?: string;
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
  avatarKind?: RouteAvatarKind;
  avatarSeed?: string;
  backgroundColor?: string;
  icon?: LucideIcon;
  title: string;
}

/**
 * For a route whose surface is mounted outside the router outlet, or that
 * paints fast enough that any placeholder is pure flicker. Declared rather than
 * omitted: an absent `Skeleton` makes `RouteLoading` render nothing, so the
 * chunk wait is a blank pane.
 */
export const NoRouteSkeleton = () => null;

export const routeMeta = (meta: RouteMeta): RouteMeta => meta;

export const getRouteMetaFromHandle = (handle: unknown): RouteMeta | undefined => {
  if (!handle || typeof handle !== 'object') return undefined;
  return (handle as RouteHandle).meta;
};
