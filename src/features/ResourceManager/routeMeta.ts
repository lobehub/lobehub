import type { LucideIcon } from 'lucide-react';
import { lazy } from 'react';

import type { RouteMeta } from '@/spa/router/routeMeta';
import { routeMeta } from '@/spa/router/routeMeta';

// Route metas load with the router on first paint; keep the file and library stores out of that graph.
const DocsItemDynamicMeta = lazy(() =>
  import('./ResourceDynamicMeta').then((module) => ({ default: module.DocsItemDynamicMeta })),
);
const LibraryDynamicMeta = lazy(() =>
  import('./ResourceDynamicMeta').then((module) => ({ default: module.LibraryDynamicMeta })),
);

/** A page or file opened over the Docs home, titled after the item. */
export const createDocsItemRouteMeta = (icon: LucideIcon, titleKey: string): RouteMeta =>
  routeMeta({ DynamicMeta: DocsItemDynamicMeta, icon, titleKey });

/** A route inside a library, titled after the opened item, folder or the library. */
export const createLibraryRouteMeta = (meta: RouteMeta): RouteMeta =>
  routeMeta({ ...meta, DynamicMeta: LibraryDynamicMeta, titleKey: 'navigation.knowledgeBase' });
