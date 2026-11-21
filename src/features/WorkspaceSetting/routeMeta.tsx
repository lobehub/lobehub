import { Settings } from 'lucide-react';
import { lazy } from 'react';

import type { DynamicRouteMetaProps, RouteMeta } from '@/spa/router/routeMeta';
import { routeMeta } from '@/spa/router/routeMeta';
import type { WorkspaceSettingsTabs } from '@/types/workspaceSettings';

// Route metas load with the router on first paint; keep the settings sidebar's stores out of that graph.
const WorkspaceSettingsDynamicMeta = lazy(() => import('./WorkspaceSettingsDynamicMeta'));

/** Workspace settings route meta, titled after the tab the route renders. */
export const createWorkspaceSettingsRouteMeta = (
  tab: WorkspaceSettingsTabs,
  Skeleton?: RouteMeta['Skeleton'],
): RouteMeta => {
  const DynamicMeta = (props: DynamicRouteMetaProps) => (
    <WorkspaceSettingsDynamicMeta {...props} tab={tab} />
  );

  return routeMeta({ DynamicMeta, icon: Settings, Skeleton, titleKey: 'navigation.settings' });
};
