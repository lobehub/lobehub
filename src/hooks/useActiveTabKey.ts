import { usePathname, useSearchParams } from 'next/navigation';

import { ProfileTabs, SettingsTabs, SidebarTabKey } from '@/store/global/initialState';

/**
 * Returns the active tab key (chat/market/settings/...)
 */
export const useActiveTabKey = () => {
  const pathname = usePathname();
  return (pathname.split('/').find(Boolean)! as SidebarTabKey) || SidebarTabKey.Home;
};

/**
 * Returns the active setting page key (?active=common/sync/agent/...)
 */
export const useActiveSettingsKey = () => {
  const search = useSearchParams();
  const tabs = search.get('active');
  if (!tabs) return SettingsTabs.Common;
  return tabs as SettingsTabs;
};

/**
 * Returns the active profile page key (profile/security/stats/...)
 */
export const useActiveProfileKey = () => {
  const pathname = usePathname();

  const tabs = pathname.split('/').at(-1);

  if (tabs === 'profile') return ProfileTabs.Profile;

  return tabs as ProfileTabs;
};
