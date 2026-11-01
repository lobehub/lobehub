import { type DynamicRouteMeta } from '@/spa/router/routeMeta';

export interface TabItem {
  cached?: DynamicRouteMeta;
  id: string;
  lastVisited: number;
  /** Pinned tabs occupy a fixed-width run at the head of the list. */
  pinned?: boolean;
  url: string;
  visitCount?: number;
}
