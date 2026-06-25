import type { LucideIcon } from 'lucide-react';
import type { ComponentType } from 'react';

export interface StaticRouteMeta {
  icon?: LucideIcon;
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

export interface RouteMeta extends StaticRouteMeta {
  DynamicMeta?: ComponentType<DynamicRouteMetaProps>;
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

export const routeMeta = (meta: RouteMeta): RouteMeta => meta;

export const getRouteMetaFromHandle = (handle: unknown): RouteMeta | undefined => {
  if (!handle || typeof handle !== 'object') return undefined;
  return (handle as RouteHandle).meta;
};
