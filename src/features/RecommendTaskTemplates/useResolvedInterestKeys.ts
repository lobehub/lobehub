import { useMemo } from 'react';

import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';
import { authSelectors } from '@/store/user/slices/auth/selectors';

/**
 * Predefined interests are stored as canonical INTEREST_AREAS keys. Freeform
 * entries are lowercased passthroughs — the server treats them as non-matching.
 *
 * Returns `null` while the login user state hasn't finished initializing
 * (`interests` is `[]` after auth loads but before `useInitUserState` merges
 * profile data, which would create a transient empty-interest SWR key).
 *
 * Callers should keep SWR disabled while null.
 */
export const useResolvedInterestKeys = (): string[] | null => {
  const isUserLoaded = useUserStore(authSelectors.isLoaded);
  const isLogin = useUserStore(authSelectors.isLogin);
  const isUserStateInit = useUserStore((s) => s.isUserStateInit);
  const userInterests = useUserStore(userProfileSelectors.interests);

  return useMemo(() => {
    if (!isUserLoaded) return null;
    if (isLogin && !isUserStateInit) return null;

    return userInterests.map((raw) => raw.trim().toLocaleLowerCase()).filter(Boolean);
  }, [isLogin, isUserLoaded, isUserStateInit, userInterests]);
};
