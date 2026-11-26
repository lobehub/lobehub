import { SettingsTabs } from '@/store/global/initialState';

/**
 * Tabs that draw their own navigation header and container: the provider
 * split pane. Every other tab renders under the one shared header that shows
 * the tab title. Their skeletons provide a `Page` for the same reason.
 * (Skills and connectors moved to the Marketplace and draw their own frame there.)
 */
export const OWN_FRAME_TABS = new Set<string>([SettingsTabs.Provider]);

/**
 * Width of the content column every in-frame tab shares, so switching tabs
 * keeps the content edges in place. Card grids such as Devices fit their
 * columns to this width instead of spanning the pane.
 */
export const SETTINGS_CONTAINER_MAX_WIDTH = 1024;

/**
 * Width of the Plans tab column. Its four plan cards side by side get about
 * 226px each in the shared 1024 column, which wraps prices and feature rows
 * on wide screens; 1280 gives each card about 290px.
 */
export const SETTINGS_PLANS_MAX_WIDTH = 1280;

/**
 * Tabs whose content spans the full pane, as on the workspace settings page:
 * the subscription account list, whose usage columns need the room.
 */
const FULL_WIDTH_SETTINGS_TABS = new Set<string>([SettingsTabs.SubscriptionAccounts]);

/**
 * Content column width for a tab. Every tab shares
 * `SETTINGS_CONTAINER_MAX_WIDTH` except the Plans tab and the full-width tabs.
 */
export const getSettingsContainerMaxWidth = (tab: string): number | string => {
  if (FULL_WIDTH_SETTINGS_TABS.has(tab)) return '100%';
  return tab === SettingsTabs.Plans ? SETTINGS_PLANS_MAX_WIDTH : SETTINGS_CONTAINER_MAX_WIDTH;
};
