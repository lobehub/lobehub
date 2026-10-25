import type { RouteObject } from 'react-router';

import { createSettingsSectionsSkeleton } from '@/components/Skeleton/Settings/Sections';
import { WORKSPACE_SETTINGS_SECTION_SHAPES } from '@/components/Skeleton/Settings/sectionShapes';
import { createSurfaceSkeleton } from '@/components/Skeleton/Surface';
import DevicesPageSkeleton from '@/features/DeviceManager/Skeleton';
import { routeMeta } from '@/spa/router/routeMeta';
import { dynamicElement, dynamicLayout, redirectElement } from '@/utils/router';

// Workspace settings tabs made of stacked filled groups. The content layout
// declares `chrome='body'` and draws the header + padded container, so inside
// it these render only the sections.
const workspaceSettingsSkeletons = {
  billing: createSettingsSectionsSkeleton(WORKSPACE_SETTINGS_SECTION_SHAPES.billing),
  budget: createSettingsSectionsSkeleton(WORKSPACE_SETTINGS_SECTION_SHAPES.budget),
  credits: createSettingsSectionsSkeleton(WORKSPACE_SETTINGS_SECTION_SHAPES.credits),
  plans: createSettingsSectionsSkeleton(WORKSPACE_SETTINGS_SECTION_SHAPES.plans),
  usage: createSettingsSectionsSkeleton(WORKSPACE_SETTINGS_SECTION_SHAPES.usage),
};

/**
 * Padded `/:slug/settings/*` tabs, sharing the centered max-width content
 * layout. Mounted under the workspace settings shell in
 * `desktopRouter.shared.tsx`; full-bleed tabs (provider, skill, connector)
 * stay there.
 */
export const workspaceSettingsContentRoute: RouteObject = {
  children: [
    {
      element: dynamicElement(
        () => import('@/routes/(main)/[workspaceSlug]/settings/general'),
        'Desktop > Workspace > Settings > General',
      ),
      handle: { meta: routeMeta({ Skeleton: createSurfaceSkeleton('form') }) },
      path: 'general',
    },
    {
      element: dynamicElement(
        () => import('@/routes/(main)/[workspaceSlug]/settings/members'),
        'Desktop > Workspace > Settings > Members',
      ),
      handle: { meta: routeMeta({ Skeleton: createSurfaceSkeleton('list') }) },
      path: 'members',
    },
    {
      element: dynamicElement(
        () => import('@/routes/(main)/[workspaceSlug]/settings/teams'),
        'Desktop > Workspace > Settings > Teams',
      ),
      handle: { meta: routeMeta({ Skeleton: createSurfaceSkeleton('list') }) },
      path: 'teams',
    },
    // Team detail — the page reads the team id from the route param.
    {
      element: dynamicElement(
        () => import('@/routes/(main)/[workspaceSlug]/settings/teams'),
        'Desktop > Workspace > Settings > Teams > Detail',
      ),
      handle: { meta: routeMeta({ Skeleton: createSurfaceSkeleton('form') }) },
      path: 'teams/:teamId',
    },
    {
      element: dynamicElement(
        () => import('@/routes/(main)/[workspaceSlug]/settings/notification'),
        'Desktop > Workspace > Settings > Notification',
      ),
      handle: { meta: routeMeta({ Skeleton: createSurfaceSkeleton('form') }) },
      path: 'notification',
    },
    // Channel detail level of the two-level notification settings —
    // the page reads the channel id from the `sub` route param.
    {
      element: dynamicElement(
        () => import('@/routes/(main)/[workspaceSlug]/settings/notification'),
        'Desktop > Workspace > Settings > Notification > Channel',
      ),
      handle: { meta: routeMeta({ Skeleton: createSurfaceSkeleton('form') }) },
      path: 'notification/:sub',
    },
    {
      element: dynamicElement(
        () => import('@/routes/(main)/[workspaceSlug]/settings/statistics'),
        'Desktop > Workspace > Settings > Statistics',
      ),
      handle: { meta: routeMeta({ Skeleton: createSurfaceSkeleton('grid') }) },
      path: 'statistics',
    },
    // Legacy `/:slug/settings/stats` URLs — kept for deep-links.
    {
      element: redirectElement('../statistics'),
      path: 'stats',
    },
    {
      element: dynamicElement(
        () => import('@/routes/(main)/[workspaceSlug]/settings/plans'),
        'Desktop > Workspace > Settings > Plans',
      ),
      handle: { meta: routeMeta({ Skeleton: workspaceSettingsSkeletons.plans }) },
      path: 'plans',
    },
    {
      element: dynamicElement(
        () => import('@/routes/(main)/[workspaceSlug]/settings/billing'),
        'Desktop > Workspace > Settings > Billing',
      ),
      handle: { meta: routeMeta({ Skeleton: workspaceSettingsSkeletons.billing }) },
      path: 'billing',
    },
    {
      element: dynamicElement(
        () => import('@/routes/(main)/[workspaceSlug]/settings/budget'),
        'Desktop > Workspace > Settings > Budget',
      ),
      handle: { meta: routeMeta({ Skeleton: workspaceSettingsSkeletons.budget }) },
      path: 'budget',
    },
    {
      element: dynamicElement(
        () => import('@/routes/(main)/[workspaceSlug]/settings/credits'),
        'Desktop > Workspace > Settings > Credits',
      ),
      handle: { meta: routeMeta({ Skeleton: workspaceSettingsSkeletons.credits }) },
      path: 'credits',
    },
    {
      element: dynamicElement(
        () => import('@/routes/(main)/[workspaceSlug]/settings/usage'),
        'Desktop > Workspace > Settings > Usage',
      ),
      handle: { meta: routeMeta({ Skeleton: workspaceSettingsSkeletons.usage }) },
      path: 'usage',
    },
    {
      element: dynamicElement(
        () => import('@/routes/(main)/[workspaceSlug]/settings/service-model'),
        'Desktop > Workspace > Settings > Service Model',
      ),
      handle: { meta: routeMeta({ Skeleton: createSurfaceSkeleton('form') }) },
      path: 'service-model',
    },
    {
      element: dynamicElement(
        () => import('@/routes/(main)/[workspaceSlug]/settings/credential'),
        'Desktop > Workspace > Settings > Credential',
      ),
      handle: { meta: routeMeta({ Skeleton: createSurfaceSkeleton('form') }) },
      path: 'credential',
    },
    // Legacy `/:slug/settings/creds` URLs — kept for deep-links.
    {
      element: redirectElement('../credential'),
      path: 'creds',
    },
    {
      element: dynamicElement(
        () => import('@/routes/(main)/[workspaceSlug]/settings/apikey'),
        'Desktop > Workspace > Settings > API Key',
      ),
      handle: { meta: routeMeta({ Skeleton: createSurfaceSkeleton('list') }) },
      path: 'apikey',
    },
    {
      element: dynamicElement(
        () => import('@/routes/(main)/[workspaceSlug]/settings/oauth-apps'),
        'Desktop > Workspace > Settings > OAuth Apps',
      ),
      handle: { meta: routeMeta({ Skeleton: createSurfaceSkeleton('list') }) },
      path: 'oauth-apps',
    },
    {
      element: dynamicElement(
        () => import('@/routes/(main)/[workspaceSlug]/settings/oauth-apps'),
        'Desktop > Workspace > Settings > OAuth App Detail',
      ),
      handle: { meta: routeMeta({ Skeleton: createSurfaceSkeleton('list') }) },
      path: 'oauth-apps/:sub',
    },
    {
      element: dynamicElement(
        () => import('@/routes/(main)/[workspaceSlug]/settings/audit-log'),
        'Desktop > Workspace > Settings > Audit Log',
      ),
      handle: { meta: routeMeta({ Skeleton: createSurfaceSkeleton('list') }) },
      path: 'audit-log',
    },
    {
      element: dynamicElement(
        () => import('@/routes/(main)/[workspaceSlug]/settings/labels'),
        'Desktop > Workspace > Settings > Labels',
      ),
      handle: { meta: routeMeta({ Skeleton: createSurfaceSkeleton('list') }) },
      path: 'labels',
    },
    {
      element: dynamicElement(
        () => import('@/routes/(main)/[workspaceSlug]/settings/storage'),
        'Desktop > Workspace > Settings > Storage',
      ),
      handle: { meta: routeMeta({ Skeleton: createSurfaceSkeleton('list') }) },
      path: 'storage',
    },
    {
      element: dynamicElement(
        () => import('@/routes/(main)/[workspaceSlug]/settings/devices'),
        'Desktop > Workspace > Settings > Devices',
      ),
      handle: { meta: routeMeta({ Skeleton: DevicesPageSkeleton }) },
      path: 'devices',
    },
    // Device detail level — the page reads the device id from `sub`.
    {
      element: dynamicElement(
        () => import('@/routes/(main)/[workspaceSlug]/settings/devices'),
        'Desktop > Workspace > Settings > Devices > Detail',
      ),
      handle: { meta: routeMeta({ Skeleton: createSurfaceSkeleton('detail') }) },
      path: 'devices/:sub',
    },
    {
      element: dynamicElement(
        () => import('@/routes/(main)/[workspaceSlug]/settings/subscription-accounts'),
        'Desktop > Workspace > Settings > Subscription Accounts',
      ),
      handle: { meta: routeMeta({ Skeleton: createSurfaceSkeleton('list') }) },
      path: 'subscription-accounts',
    },
    {
      element: dynamicElement(
        () => import('@/routes/(main)/[workspaceSlug]/settings/environments'),
        'Desktop > Workspace > Settings > Environments',
      ),
      handle: { meta: routeMeta({ Skeleton: createSurfaceSkeleton('list') }) },
      path: 'environments',
    },
    {
      element: dynamicElement(
        () => import('@/routes/(main)/[workspaceSlug]/settings/drive'),
        'Desktop > Workspace > Settings > Drive',
      ),
      handle: { meta: routeMeta({ Skeleton: createSurfaceSkeleton('list') }) },
      path: 'drive',
    },
    // Account-level tabs mirrored inside the workspace so members can
    // adjust user settings without leaving the workspace. Same pages
    // as personal `/settings/*`; only the chrome is workspace-owned.
    {
      element: dynamicElement(
        () => import('@/routes/(main)/[workspaceSlug]/settings/profile'),
        'Desktop > Workspace > Settings > Profile',
      ),
      handle: { meta: routeMeta({ Skeleton: createSurfaceSkeleton('form') }) },
      path: 'profile',
    },
    {
      element: dynamicElement(
        () => import('@/routes/(main)/[workspaceSlug]/settings/appearance'),
        'Desktop > Workspace > Settings > Appearance',
      ),
      handle: { meta: routeMeta({ Skeleton: createSurfaceSkeleton('form') }) },
      path: 'appearance',
    },
    {
      element: dynamicElement(
        () => import('@/routes/(main)/[workspaceSlug]/settings/hotkey'),
        'Desktop > Workspace > Settings > Hotkey',
      ),
      handle: { meta: routeMeta({ Skeleton: createSurfaceSkeleton('form') }) },
      path: 'hotkey',
    },
    {
      element: dynamicElement(
        () => import('@/routes/(main)/[workspaceSlug]/settings/chat-preference'),
        'Desktop > Workspace > Settings > Chat Preference',
      ),
      handle: { meta: routeMeta({ Skeleton: createSurfaceSkeleton('form') }) },
      path: 'chat-preference',
    },
    {
      element: dynamicElement(
        () => import('@/routes/(main)/[workspaceSlug]/settings/messenger'),
        'Desktop > Workspace > Settings > Messenger',
      ),
      handle: { meta: routeMeta({ Skeleton: createSurfaceSkeleton('list') }) },
      path: 'messenger',
    },
    // Platform detail level — the page reads the platform from `sub`.
    {
      element: dynamicElement(
        () => import('@/routes/(main)/[workspaceSlug]/settings/messenger'),
        'Desktop > Workspace > Settings > Messenger > Platform',
      ),
      handle: { meta: routeMeta({ Skeleton: createSurfaceSkeleton('list') }) },
      path: 'messenger/:sub',
    },
    {
      element: dynamicElement(
        () => import('@/routes/(main)/[workspaceSlug]/settings/integrations'),
        'Desktop > Workspace > Settings > Integrations',
      ),
      handle: { meta: routeMeta({ Skeleton: createSurfaceSkeleton('list') }) },
      path: 'integrations',
    },
    // Integration detail level — the page reads the integration from `sub`.
    {
      element: dynamicElement(
        () => import('@/routes/(main)/[workspaceSlug]/settings/integrations'),
        'Desktop > Workspace > Settings > Integrations > Detail',
      ),
      handle: { meta: routeMeta({ Skeleton: createSurfaceSkeleton('list') }) },
      path: 'integrations/:sub',
    },
    // Developer tools mirrored inside the workspace (user preferences).
    {
      element: dynamicElement(
        () => import('@/routes/(main)/[workspaceSlug]/settings/advanced'),
        'Desktop > Workspace > Settings > Advanced',
      ),
      handle: { meta: routeMeta({ Skeleton: createSurfaceSkeleton('form') }) },
      path: 'advanced',
    },
    {
      element: dynamicElement(
        () => import('@/routes/(main)/[workspaceSlug]/settings/labs'),
        'Desktop > Workspace > Settings > Labs',
      ),
      handle: { meta: routeMeta({ Skeleton: createSurfaceSkeleton('form') }) },
      path: 'labs',
    },
    {
      element: dynamicElement(
        () => import('@/routes/(main)/[workspaceSlug]/settings/about'),
        'Desktop > Workspace > Settings > About',
      ),
      handle: { meta: routeMeta({ Skeleton: createSurfaceSkeleton('form') }) },
      path: 'about',
    },
  ],
  element: dynamicLayout(
    () => import('@/routes/(main)/[workspaceSlug]/settings/_content-layout'),
    'Desktop > Workspace > Settings > Content Layout',
    { preloadId: 'settings' },
  ),
};
