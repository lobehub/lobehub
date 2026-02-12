'use client';

import { OFFICIAL_URL } from '@lobechat/const';
import { useCallback } from 'react';

import { getDesktopOnboardingCompleted } from '@/app/[variants]/(desktop)/desktop-onboarding/storage';
import { isDesktop } from '@/const/version';
import { useElectronStore } from '@/store/electron';
import { useUserStore } from '@/store/user';
import { onboardingSelectors } from '@/store/user/selectors';
import { type UserInitializationState } from '@/types/user';

const redirectIfNotOn = (currentPath: string, path: string) => {
  if (!currentPath.startsWith(path)) {
    window.location.href = path;
  }
};

export const useDesktopUserStateRedirect = () => {
  const dataSyncConfig = useElectronStore((s) => s.dataSyncConfig);
  const logout = useUserStore((s) => s.logout);

  const openExternalAndLogout = useCallback(
    async (path: string) => {
      const baseUrl = dataSyncConfig.remoteServerUrl || OFFICIAL_URL;
      let targetUrl = baseUrl;
      try {
        targetUrl = new URL(path, baseUrl).toString();
      } catch {
        // Ignore: keep fallback URL for external open attempt.
      }

      try {
        const { electronSystemService } = await import('@/services/electron/system');
        await electronSystemService.openExternalLink(targetUrl);
      } catch {
        // Ignore: fallback to logout flow even if IPC is unavailable.
      }

      try {
        const { remoteServerService } = await import('@/services/electron/remoteServer');
        await remoteServerService.clearRemoteServerConfig();
      } catch {
        // Ignore: fallback to logout flow even if IPC is unavailable.
      }

      await logout();
    },
    [dataSyncConfig.remoteServerUrl, logout],
  );

  return useCallback(
    (state: UserInitializationState) => {
      if (state.isInviteCodeRequired === true) {
        void openExternalAndLogout('/invite-code');
        return;
      }

      if (!getDesktopOnboardingCompleted()) return;
      // Desktop onboarding is handled by desktop-only flow.
    },
    [openExternalAndLogout],
  );
};

export const useWebUserStateRedirect = () =>
  useCallback((state: UserInitializationState) => {
    const { pathname } = window.location;

    if (state.isInviteCodeRequired === true) {
      redirectIfNotOn(pathname, '/invite-code');
      return;
    }

    // Redirect away from invite-code page if no longer required
    // Skip redirect if force=true is present (for re-entering invite code)
    if (pathname.startsWith('/invite-code')) {
      const params = new URLSearchParams(window.location.search);
      if (params.get('force') !== 'true') {
        window.location.href = '/';
        return;
      }
    }

    if (!onboardingSelectors.needsOnboarding(state)) return;

    redirectIfNotOn(pathname, '/onboarding');
  }, []);

export const useUserStateRedirect = () => {
  const desktopRedirect = useDesktopUserStateRedirect();
  const webRedirect = useWebUserStateRedirect();

  return useCallback(
    (state: UserInitializationState) => {
      const redirect = isDesktop ? desktopRedirect : webRedirect;
      redirect(state);
    },
    [desktopRedirect, webRedirect],
  );
};
