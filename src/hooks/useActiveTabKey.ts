import { ProfileTabs, SettingsTabs, SidebarTabKey } from '@/store/global/initialState';
import { useRouterStore } from '@/store/router';

export const getActiveTabKey = (pathname: string): SidebarTabKey =>
  (pathname.split('/').find(Boolean)! as SidebarTabKey) || SidebarTabKey.Home;

/**
 * Returns the active tab key (chat/market/settings/...)
 * React Router version for SPA
 */
export const useActiveTabKey = () => {
  return useRouterStore((state) => getActiveTabKey(state.location.pathname));
};

/**
 * Returns the active setting page key (?active=common/sync/agent/...)
 * React Router version for SPA
 */
export const useActiveSettingsKey = () => {
  return useRouterStore((state) => {
    const tab = new URLSearchParams(state.location.search).get('active');
    return (tab as SettingsTabs | null) ?? SettingsTabs.Appearance;
  });
};

/**
 * Returns the active profile page key (profile/security/stats/...)
 * React Router version for SPA
 */
export const useActiveProfileKey = () => {
  return useRouterStore((state) => {
    const tab = state.location.pathname.split('/').at(-1);
    return tab === 'profile' ? ProfileTabs.Profile : (tab as ProfileTabs);
  });
};
