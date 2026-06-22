import { type DynamicRouteMeta } from '@/spa/router/routeMeta';

import { type TabScope } from './scope';

export interface TabItem {
  cached?: DynamicRouteMeta;
  id: string;
  lastVisited: number;
  scope: TabScope;
  url: string;
  visitCount?: number;
}
