import { useMemo } from 'react';

import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';
import { authSelectors } from '@/store/user/slices/auth/selectors';

/**
 * Predefined interests are stored as canonical INTEREST_AREAS keys. Freeform
 * entries are lowercased passthroughs — the server treats them as non-matching.
 *
 * Returns `null` while the user store hasn't finished hydrating (`interests`
 * is `[]` until then, which would fire an SWR request with empty keys and
 * immediately re-fire once the real interests land — wasted round trip).
 *
 * Callers should keep SWR disabled while null.
 */
export const useResolvedInterestKeys = (): string[] | null => {
  const isUserLoaded = useUserStore(authSelectors.isLoaded);
  const userInterests = useUserStore(userProfileSelectors.interests);

  return useMemo(() => {
    if (!isUserLoaded) return null;

    return userInterests.map((raw) => raw.trim().toLocaleLowerCase()).filter(Boolean);
  }, [isUserLoaded, userInterests]);
};
