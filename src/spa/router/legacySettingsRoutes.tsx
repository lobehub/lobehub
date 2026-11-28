import { type RouteObject } from 'react-router';

import { SettingsTabs } from '@/store/global/initialState';
import { redirectElement } from '@/utils/router';

/**
 * Retired personal settings tab keys and the tab that replaced them.
 *
 * They need static routes: `/settings/agent` and `/settings/image` otherwise
 * match the workspace `/:workspaceSlug/agent` and `/:workspaceSlug/image`
 * pages first and land on "page not found".
 */
const RETIRED_SETTINGS_TABS = {
  [SettingsTabs.Agent]: SettingsTabs.ServiceModel,
  [SettingsTabs.ChatAppearance]: SettingsTabs.Conversation,
  [SettingsTabs.Common]: SettingsTabs.Appearance,
  [SettingsTabs.Image]: SettingsTabs.ServiceModel,
  [SettingsTabs.TTS]: SettingsTabs.ServiceModel,
} as const;

/** Children of `/settings`: each retired tab key opens its replacement. */
export const legacySettingsTabRedirects: RouteObject[] = Object.entries(RETIRED_SETTINGS_TABS).map(
  ([from, to]) => ({ element: redirectElement(`/settings/${to}`), path: from }),
);

const WORKSPACE_BILLING_TABS = ['plans', 'usage', 'credits', 'billing'] as const;

/**
 * Legacy `/:workspaceSlug/billing/*` URLs open the matching
 * `/:workspaceSlug/settings/*` page. A redirect resolves `..` per route, so
 * `../..` leaves both `<tab>` and `billing` before entering `settings`.
 */
export const legacyWorkspaceBillingRoute: RouteObject = {
  children: WORKSPACE_BILLING_TABS.map((tab) => ({
    element: redirectElement(`../../settings/${tab}`),
    path: tab,
  })),
  path: 'billing',
};
