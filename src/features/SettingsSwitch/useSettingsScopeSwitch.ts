import { useEffect, useMemo } from 'react';

import {
  filterGroupsByScope,
  getActiveSettingsScope,
  getSettingsScopeEntryTab,
  otherSettingsScope,
  rememberSettingsTab,
  type ScopedSettingsGroup,
  type SettingsScope,
} from './settingsScope';

interface UseSettingsScopeSwitchOptions<Group extends ScopedSettingsGroup> {
  activeTab: string | undefined;
  groups: Group[];
  /** `personal` for `/settings/*`, the workspace slug for `/:slug/settings/*`. */
  spaceKey: string;
  tabUrl: (tab: Group['items'][number]['key']) => string;
}

interface SettingsScopeSwitch<Group> {
  /** The set the active tab belongs to; the sidebar shows only its groups. */
  scope: SettingsScope;
  scopeGroups: Group[];
  /** The other set, which the switch card opens. */
  switchScope: SettingsScope;
  /** Undefined when the other set has no visible tab. */
  switchUrl?: string;
}

/**
 * Splits a settings sidebar into its account and space sets, remembers the
 * last tab of the visible set and resolves where the switch card leads.
 */
export const useSettingsScopeSwitch = <Group extends ScopedSettingsGroup>({
  activeTab,
  groups,
  spaceKey,
  tabUrl,
}: UseSettingsScopeSwitchOptions<Group>): SettingsScopeSwitch<Group> => {
  const scope = getActiveSettingsScope(groups, activeTab);
  const switchScope = otherSettingsScope(scope);
  const scopeGroups = useMemo(() => filterGroupsByScope(groups, scope), [groups, scope]);
  const isListed = scopeGroups.some((group) =>
    group.items.some((item) => !item.href && item.key === activeTab),
  );

  useEffect(() => {
    if (activeTab && isListed) rememberSettingsTab(spaceKey, scope, activeTab);
  }, [activeTab, isListed, scope, spaceKey]);

  // Read on every render (cheap) so the card follows the tab remembered above.
  const switchTab = getSettingsScopeEntryTab(spaceKey, switchScope, groups);

  return {
    scope,
    scopeGroups,
    switchScope,
    switchUrl: switchTab ? tabUrl(switchTab) : undefined,
  };
};
