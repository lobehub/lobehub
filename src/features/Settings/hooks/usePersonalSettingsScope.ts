import { useCallback, useMemo } from 'react';

import { getTabUrl } from '@/features/SettingsSearch';
import { useSettingsScopeSwitch } from '@/features/SettingsSwitch/useSettingsScopeSwitch';
import { useActiveLocation } from '@/hooks/useActiveLocation';
import { SettingsTabs } from '@/store/global/initialState';

import { useCategory } from './useCategory';

/** Space key of the personal space in the remembered-tab registry. */
export const PERSONAL_SETTINGS_SPACE_KEY = 'personal';

/**
 * Active tab of `/settings/*` and which settings set it belongs to: the
 * account set or the personal space set.
 */
export const usePersonalSettingsScope = () => {
  const categoryGroups = useCategory();
  const location = useActiveLocation();

  // pathname is like /settings/profile or /settings/provider/xxx
  const activeTab = useMemo(() => {
    const pathParts = location.pathname.split('/');
    if (pathParts.length >= 3 && pathParts[2]) return pathParts[2] as SettingsTabs;
    return SettingsTabs.Profile;
  }, [location.pathname]);

  const tabUrl = useCallback(
    (tab: SettingsTabs) =>
      categoryGroups.flatMap((group) => group.items).find((item) => item.key === tab)?.href ??
      getTabUrl(tab),
    [categoryGroups],
  );

  const scopeSwitch = useSettingsScopeSwitch({
    activeTab,
    groups: categoryGroups,
    spaceKey: PERSONAL_SETTINGS_SPACE_KEY,
    tabUrl,
  });

  return { ...scopeSwitch, activeTab, categoryGroups, tabUrl };
};
