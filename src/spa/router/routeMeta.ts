import { type LucideIcon } from 'lucide-react';

export interface StaticRouteMeta {
  icon?: LucideIcon;
  titleKey?: string;
}

export interface DynamicRouteMeta {
  avatar?: string;
  backgroundColor?: string;
  title?: string;
}

export interface NewTabActionResult {
  cached?: DynamicRouteMeta;
  url: string;
}

export interface NewTabAction {
  onCreate: () => Promise<NewTabActionResult | null>;
}

export interface RouteMeta extends StaticRouteMeta {
  createNewTab?: (params: Record<string, string | undefined>) => NewTabAction | null;
  useDynamicMeta?: (params: Record<string, string | undefined>) => DynamicRouteMeta;
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
