import { type DynamicRouteMeta } from '@/spa/router/routeMeta';

export interface TabItem {
  cached?: DynamicRouteMeta;
  id: string;
  lastVisited: number;
  url: string;
  visitCount?: number;
}
