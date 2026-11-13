'use client';

import { Settings } from 'lucide-react';
import type { RouteObject } from 'react-router';

import WorkspaceProviderRedirect from '@/features/WorkspaceSetting/ProviderRedirect';
import { createWorkspaceSettingsRouteMeta } from '@/features/WorkspaceSetting/routeMeta';
import { routeMeta } from '@/spa/router/routeMeta';
import { workspaceSettingsContentRoute } from '@/spa/router/workspaceSettingsRoutes';
import { WorkspaceSettingsTabs } from '@/types/workspaceSettings';
import { dynamicElement } from '@/utils/router';

/**
 * `/:slug/settings/*` on mobile: the mobile settings menu, then every padded
 * desktop tab from `workspaceSettingsContentRoute` (so a tab added there is
 * mounted here too), then the full-bleed tabs desktop mounts beside them.
 * Mobile renders them under the mobile settings header instead of the desktop
 * sidebar + content layout.
 */
export const mobileWorkspaceSettingsChildren: RouteObject[] = [
  {
    element: dynamicElement(
      () => import('@/routes/(mobile)/[workspaceSlug]/settings'),
      'Mobile > Workspace > Settings > Index',
    ),
    handle: { meta: routeMeta({ icon: Settings, titleKey: 'navigation.settings' }) },
    index: true,
  },
  ...(workspaceSettingsContentRoute.children ?? []),
  {
    element: dynamicElement(
      () =>
        import('@/routes/(main)/[workspaceSlug]/settings/provider').then(
          (m) => m.WorkspaceProviderSettingMobile,
        ),
      'Mobile > Workspace > Settings > Provider',
    ),
    handle: { meta: createWorkspaceSettingsRouteMeta(WorkspaceSettingsTabs.Provider) },
    path: 'provider',
  },
  // Path-shaped provider deep-links (`/:slug/settings/provider/:id`) redirect
  // to the query form the workspace provider page uses. Static element: the
  // redirect is tiny and lazy-loading it would flash the brand loader first.
  { element: <WorkspaceProviderRedirect />, path: 'provider/:providerId' },
  {
    element: dynamicElement(
      () => import('@/routes/(main)/[workspaceSlug]/settings/skill'),
      'Mobile > Workspace > Settings > Skill',
    ),
    handle: { meta: createWorkspaceSettingsRouteMeta(WorkspaceSettingsTabs.Skill) },
    path: 'skill',
  },
  {
    element: dynamicElement(
      () => import('@/routes/(main)/[workspaceSlug]/settings/connector'),
      'Mobile > Workspace > Settings > Connector',
    ),
    handle: { meta: createWorkspaceSettingsRouteMeta(WorkspaceSettingsTabs.Connector) },
    path: 'connector',
  },
];
