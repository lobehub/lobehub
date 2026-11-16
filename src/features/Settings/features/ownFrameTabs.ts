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

/**
 * Container name of the settings pane on tabs in `WIDE_CONTENT_TABS`. Content
 * on those tabs can size a block to the pane, wider than the shared column.
 */
export const SETTINGS_PANE_CONTAINER = 'settings-pane';

/**
 * Tabs whose pane is an inline-size container, so a block can outgrow the
 * shared column on a wide pane: five plan cards fit one row only past it.
 * Other tabs stay off it, since unnamed container queries and `cq*` units in
 * their content (Trash list columns) would start resolving against the pane.
 */
export const WIDE_CONTENT_TABS = new Set<string>([SettingsTabs.Plans]);
