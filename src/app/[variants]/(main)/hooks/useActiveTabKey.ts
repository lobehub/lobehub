import { useLocation, useSearchParams } from 'react-router-dom';

import { ProfileTabs, SettingsTabs, type SidebarTabKey } from '@/store/global/initialState';

/**
 * Returns the active tab key (chat/discover/settings/...)
 * React Router version for (main) directory
 */
export const useActiveTabKey = () => {
  const location = useLocation();
  const pathname = location.pathname;

  return pathname.split('/').find(Boolean) as SidebarTabKey;
};

/**
 * Returns the active setting page key (?active=common/sync/agent/...)
 * React Router version for (main) directory
 */
export const useActiveSettingsKey = () => {
  const [searchParams] = useSearchParams();
  const tabs = searchParams.get('active');
  if (!tabs) return SettingsTabs.Common;
  return tabs as SettingsTabs;
};

/**
 * Returns the active profile page key (profile/security/stats/...)
 * React Router version for (main) directory
 */
export const useActiveProfileKey = () => {
  const location = useLocation();
  const pathname = location.pathname;

  const tabs = pathname.split('/').findLast(Boolean);

  if (tabs === 'profile') return ProfileTabs.Profile;

  return tabs as ProfileTabs;
};
