'use client';

import { isDesktop } from '@lobechat/const';
import type { PropsWithChildren } from 'react';
import { useLayoutEffect, useState } from 'react';

import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

interface AppBootstrapReadiness {
  authLoaded: boolean;
  desktop: boolean;
  desktopOnboarding: boolean;
  userStateInitialized: boolean;
}

export const isAppBootstrapReady = ({
  authLoaded,
  desktop,
  desktopOnboarding,
  userStateInitialized,
}: AppBootstrapReadiness): boolean => {
  if (!desktop) return authLoaded;

  // DesktopAuthProvider marks auth loaded before its local identity request
  // resolves. Normal desktop routes therefore wait for the final user scope.
  // Onboarding deliberately runs before that request and must remain reachable.
  return desktopOnboarding || userStateInitialized;
};

/**
 * Blocks only the initial app surface until the current identity is settled.
 *
 * The persisted active cache scope is an optimistic hydration hint, not proof
 * of authentication. Keeping consumers unmounted during the session check
 * prevents a logged-out, expired, or switched account from seeing the previous
 * user's Home data. This is a one-way latch so focus revalidation never blanks
 * an already-running app.
 */
const AppBootstrapGate = ({ children }: PropsWithChildren) => {
  const desktopOnboarding =
    isDesktop &&
    typeof window !== 'undefined' &&
    window.location.pathname.startsWith('/desktop-onboarding');
  const identityReady = useUserStore((state) =>
    isAppBootstrapReady({
      authLoaded: Boolean(authSelectors.isLoaded(state)),
      desktop: isDesktop,
      desktopOnboarding,
      userStateInitialized: state.isUserStateInit,
    }),
  );
  const [released, setReleased] = useState(identityReady);

  useLayoutEffect(() => {
    if (identityReady) setReleased(true);
  }, [identityReady]);

  if (!released) return null;

  return <>{children}</>;
};

export default AppBootstrapGate;
