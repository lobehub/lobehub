'use client';

import { useCallback } from 'react';

import { isDesktop } from '@/const/version';
import { onboardingSelectors } from '@/store/user/selectors';
import { type UserInitializationState } from '@/types/user';
import { buildOnboardingRedirectUrl } from '@/utils/onboardingRedirect';

const redirectToOnboarding = (currentPath: string, search: string) => {
  if (!currentPath.startsWith('/onboarding')) {
    // Thread the page the user was on so onboarding finish points return there
    window.location.href = buildOnboardingRedirectUrl(currentPath + search);
  }
};

export const useDesktopUserStateRedirect = () => {
  // Desktop onboarding redirect is now handled by main process (BrowserManager)
  // No need to check localStorage here
  return useCallback(() => {}, []);
};

export const useWebUserStateRedirect = () =>
  useCallback((state: UserInitializationState) => {
    const { pathname, search } = window.location;

    if (!onboardingSelectors.needsOnboarding(state)) return;

    redirectToOnboarding(pathname, search);
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
