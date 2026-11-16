import { SettingsTabs } from '@/store/global/initialState';

/**
 * Tabs that draw their own navigation header and container: the split panes
 * (provider, skill) and the connector page that reuses the skill pane. Every
 * other tab renders under the one shared header that shows the tab title.
 * Their skeletons provide a `Page` for the same reason.
 */
export const OWN_FRAME_TABS = new Set<string>([
  SettingsTabs.Connector,
  SettingsTabs.Provider,
  SettingsTabs.Skill,
]);

/**
 * Width of the content column every in-frame tab shares, so switching tabs
 * keeps the content edges in place. Card grids such as Devices fit their
 * columns to this width instead of spanning the pane.
 */
export const SETTINGS_CONTAINER_MAX_WIDTH = 1024;
