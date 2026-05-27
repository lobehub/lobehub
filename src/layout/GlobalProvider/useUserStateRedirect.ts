'use client';

import { useCallback } from 'react';

import { isDesktop } from '@/const/version';
import { onboardingSelectors } from '@/store/user/selectors';
import { type UserInitializationState } from '@/types/user';

const redirectIfNotOn = (currentPath: string, path: string) => {
  if (!currentPath.startsWith(path)) {
    window.location.href = path;
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

    // Skip onboarding when the user lands on any agent page with a message param
    // (e.g. "Try in LobeHub" links from Skills Marketplace). The /agent/inbox slug
    // may be rewritten to /agent/{resolvedId} by AgentIdSync before this callback
    // fires, so matching only /agent/inbox would miss the resolved-slug case.
    if (pathname.startsWith('/agent/') && new URLSearchParams(search).has('message')) return;

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
