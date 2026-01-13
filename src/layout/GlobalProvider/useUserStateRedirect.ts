'use client';

import { OFFICIAL_URL } from '@lobechat/const';
import { usePathname } from 'next/navigation';
import { useCallback } from 'react';

import { getDesktopOnboardingCompleted } from '@/app/[variants]/(desktop)/desktop-onboarding/storage';
import { isDesktop } from '@/const/version';
import { useElectronStore } from '@/store/electron';
import { useUserStore } from '@/store/user';
import { onboardingSelectors } from '@/store/user/selectors';
import type { UserInitializationState } from '@/types/user';

const redirectIfNotOn = (currentPath: string | null | undefined, path: string) => {
  if (!currentPath?.startsWith(path)) {
    window.location.href = path;
  }
};

const useCurrentPathname = () => {
  const pathname = usePathname();
  return useCallback(() => {
    if (typeof window === 'undefined') return pathname;
    return window.location.pathname || pathname;
  }, [pathname]);
};

export const useDesktopUserStateRedirect = () => {
  const dataSyncConfig = useElectronStore((s) => s.dataSyncConfig);
  const logout = useUserStore((s) => s.logout);

  const handleDesktopWaitlist = useCallback(async () => {
    const waitlistBaseUrl = dataSyncConfig.remoteServerUrl || OFFICIAL_URL;
    let waitlistUrl = waitlistBaseUrl;
    try {
      waitlistUrl = new URL('/waitlist', waitlistBaseUrl).toString();
    } catch {
      // Ignore: keep fallback URL for external open attempt.
    }

    try {
      const { electronSystemService } = await import('@/services/electron/system');
      await electronSystemService.openExternalLink(waitlistUrl);
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
  }, [dataSyncConfig.remoteServerUrl, logout]);

  return useCallback(
    (state: UserInitializationState) => {
      if (state.isInWaitList === true) {
        void handleDesktopWaitlist();
        return;
      }

      if (!getDesktopOnboardingCompleted()) return;
      // Desktop onboarding is handled by desktop-only flow.
    },
    [handleDesktopWaitlist],
  );
};

export const useWebUserStateRedirect = (getCurrentPathname: () => string | null | undefined) =>
  useCallback(
    (state: UserInitializationState) => {
      if (state.isInWaitList === true) {
        redirectIfNotOn(getCurrentPathname(), '/waitlist');
        return;
      }

      if (!onboardingSelectors.needsOnboarding(state)) return;

      redirectIfNotOn(getCurrentPathname(), '/onboarding');
    },
    [getCurrentPathname],
  );

export const useUserStateRedirect = () => {
  const getCurrentPathname = useCurrentPathname();
  const desktopRedirect = useDesktopUserStateRedirect();
  const webRedirect = useWebUserStateRedirect(getCurrentPathname);

  return useCallback(
    (state: UserInitializationState) => {
      const redirect = isDesktop ? desktopRedirect : webRedirect;
      redirect(state);
    },
    [desktopRedirect, webRedirect],
  );
};
