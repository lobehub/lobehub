import { usePathname, useSearchParams } from '@/libs/router/navigation';
import { type SidebarTabKey } from '@/store/global/initialState';
import { ProfileTabs, SettingsTabs } from '@/store/global/initialState';

/**
 * Returns the active tab key (chat/discover/settings/...)
 * Uses React Router via @/libs/router
 */
export const useActiveTabKey = () => {
  const pathname = usePathname();
  return pathname.split('/').find(Boolean) as SidebarTabKey;
};

/**
 * Returns the active setting page key (?active=common/sync/agent/...)
 * Uses React Router via @/libs/router
 */
export const useActiveSettingsKey = () => {
  const [searchParams] = useSearchParams();
  const tabs = searchParams.get('active');
  if (!tabs) return SettingsTabs.Common;
  return tabs as SettingsTabs;
};

/**
 * Returns the active profile page key (profile/security/stats/...)
 * Uses React Router via @/libs/router
 */
export const useActiveProfileKey = () => {
  const pathname = usePathname();
  const tabs = pathname.split('/').findLast(Boolean);

  if (tabs === 'profile') return ProfileTabs.Profile;

  return tabs as ProfileTabs;
};
