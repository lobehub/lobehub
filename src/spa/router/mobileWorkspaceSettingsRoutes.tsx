'use client';

import type { RouteObject } from 'react-router';

import { dynamicElement, redirectElement } from '@/utils/router';

/**
 * Workspace settings tabs the mobile tree mounts beside the ones listed inline
 * in `mobileRouter.config.tsx`. Same pages as desktop's
 * `workspaceSettingsRoutes.tsx`; mobile renders them under the mobile settings
 * header instead of the desktop sidebar + content layout.
 */
export const mobileWorkspaceSettingsExtraRoutes: RouteObject[] = [
  {
    element: dynamicElement(
      () => import('@/routes/(main)/[workspaceSlug]/settings/statistics'),
      'Mobile > Workspace > Settings > Statistics',
    ),
    path: 'statistics',
  },
  // Legacy `/:slug/settings/stats` URLs — kept for deep-links.
  { element: redirectElement('../statistics'), path: 'stats' },
  {
    element: dynamicElement(
      () => import('@/routes/(main)/[workspaceSlug]/settings/service-model'),
      'Mobile > Workspace > Settings > Service Model',
    ),
    path: 'service-model',
  },
  {
    element: dynamicElement(
      () => import('@/routes/(main)/[workspaceSlug]/settings/credential'),
      'Mobile > Workspace > Settings > Credential',
    ),
    path: 'credential',
  },
  // Legacy `/:slug/settings/creds` URLs — kept for deep-links.
  { element: redirectElement('../credential'), path: 'creds' },
  {
    element: dynamicElement(
      () => import('@/routes/(main)/[workspaceSlug]/settings/apikey'),
      'Mobile > Workspace > Settings > API Key',
    ),
    path: 'apikey',
  },
  {
    element: dynamicElement(
      () => import('@/routes/(main)/[workspaceSlug]/settings/storage'),
      'Mobile > Workspace > Settings > Storage',
    ),
    path: 'storage',
  },
  {
    element: dynamicElement(
      () => import('@/routes/(main)/[workspaceSlug]/settings/devices'),
      'Mobile > Workspace > Settings > Devices',
    ),
    path: 'devices',
  },
  {
    element: dynamicElement(
      () => import('@/routes/(main)/[workspaceSlug]/settings/devices'),
      'Mobile > Workspace > Settings > Devices > Detail',
    ),
    path: 'devices/:sub',
  },
  {
    element: dynamicElement(
      () => import('@/routes/(main)/[workspaceSlug]/settings/environments'),
      'Mobile > Workspace > Settings > Environments',
    ),
    path: 'environments',
  },
  {
    element: dynamicElement(
      () => import('@/routes/(main)/[workspaceSlug]/settings/drive'),
      'Mobile > Workspace > Settings > Drive',
    ),
    path: 'drive',
  },
  {
    element: dynamicElement(
      () => import('@/routes/(main)/[workspaceSlug]/settings/integrations'),
      'Mobile > Workspace > Settings > Integrations',
    ),
    path: 'integrations',
  },
  {
    element: dynamicElement(
      () => import('@/routes/(main)/[workspaceSlug]/settings/integrations'),
      'Mobile > Workspace > Settings > Integrations > Detail',
    ),
    path: 'integrations/:sub',
  },
  {
    element: dynamicElement(
      () => import('@/routes/(main)/[workspaceSlug]/settings/skill'),
      'Mobile > Workspace > Settings > Skill',
    ),
    path: 'skill',
  },
  {
    element: dynamicElement(
      () => import('@/routes/(main)/[workspaceSlug]/settings/connector'),
      'Mobile > Workspace > Settings > Connector',
    ),
    path: 'connector',
  },
];
