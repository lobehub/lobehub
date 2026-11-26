/**
 * Which of the two settings sets a sidebar group belongs to.
 *
 * - `account`: follows the user across every space (profile, appearance,
 *   hotkeys, messenger, labs, …).
 * - `space`: belongs to the current space — the personal space under
 *   `/settings/*`, or a workspace under `/:workspaceSlug/settings/*`
 *   (providers, devices, credentials, billing, members, …).
 *
 * Both sets live under the current space's URL prefix, so opening account
 * settings never moves the user out of the workspace they are in. The sidebar
 * shows only the set the active tab belongs to, and the card at its bottom
 * switches to the other one.
 */
export type SettingsScope = 'account' | 'space';

export interface ScopedSettingsGroup<TabKey extends string = string> {
  /**
   * `href` marks a link out of this space (a personal-only page listed in a
   * workspace's account set). It is never the active tab here, so it neither
   * decides the active set nor becomes the remembered tab; its key may repeat
   * a tab of this space, e.g. personal vs workspace Notifications.
   */
  items: { href?: string; key: TabKey }[];
  scope: SettingsScope;
}

/**
 * The set the active tab belongs to. A tab the account set does not list
 * (space tabs, sub-pages, tabs hidden by a permission) falls back to the space
 * set, which is where every surface's index route lands except Profile.
 */
export const getActiveSettingsScope = <TabKey extends string>(
  groups: ScopedSettingsGroup<TabKey>[],
  activeTab: string | undefined,
): SettingsScope =>
  groups.some(
    (group) =>
      group.scope === 'account' && group.items.some((item) => !item.href && item.key === activeTab),
  )
    ? 'account'
    : 'space';

export const filterGroupsByScope = <Group extends ScopedSettingsGroup>(
  groups: Group[],
  scope: SettingsScope,
): Group[] => groups.filter((group) => group.scope === scope);

export const otherSettingsScope = (scope: SettingsScope): SettingsScope =>
  scope === 'account' ? 'space' : 'account';

/**
 * Last tab visited in each set, keyed per space. Kept in memory for the
 * session: the switch card returns to it, so going account → space → account
 * lands back on the tab the user left.
 */
const rememberedTabs = new Map<string, string>();

const rememberKey = (spaceKey: string, scope: SettingsScope) => `${spaceKey}:${scope}`;

export const rememberSettingsTab = (spaceKey: string, scope: SettingsScope, tab: string) => {
  rememberedTabs.set(rememberKey(spaceKey, scope), tab);
};

/** Test-only: forget every remembered tab. */
export const resetRememberedSettingsTabs = () => rememberedTabs.clear();

/**
 * The tab the switch card opens in `scope`: the one last visited there when
 * the sidebar still lists it, otherwise that set's first tab.
 */
export const getSettingsScopeEntryTab = <TabKey extends string>(
  spaceKey: string,
  scope: SettingsScope,
  groups: ScopedSettingsGroup<TabKey>[],
): TabKey | undefined => {
  const items = filterGroupsByScope(groups, scope)
    .flatMap((group) => group.items)
    .filter((item) => !item.href);
  const remembered = rememberedTabs.get(rememberKey(spaceKey, scope));
  return items.find((item) => item.key === remembered)?.key ?? items[0]?.key;
};
