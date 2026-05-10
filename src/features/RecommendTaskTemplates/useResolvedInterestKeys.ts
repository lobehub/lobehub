import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { resolveInterestAreaKey } from '@/routes/onboarding/utils/interestKeys';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';
import { authSelectors } from '@/store/user/slices/auth/selectors';

/**
 * New writes store canonical INTEREST_AREAS keys in `user.interests`, but
 * existing users may still have localized labels (e.g. "内容创作",
 * "Content Creation") or i18n keys from older builds. Resolve known legacy
 * values back to canonical keys before matching task templates. Unresolved
 * freeform entries are lowercased passthroughs — the server treats them as
 * non-matching.
 *
 * Returns `null` while either:
 *   - the user store hasn't finished hydrating (`interests` is `[]` until then,
 *     which would fire an SWR request with empty keys and immediately re-fire
 *     once the real interests land — wasted round trip), or
 *   - the onboarding namespace is still loading (lazy-loaded, not in startup
 *     bundle; without this gate localized labels resolve to passthrough strings
 *     on first render and re-resolve correctly after the namespace lands).
 *
 * Callers should keep SWR disabled while null.
 */
export const useResolvedInterestKeys = (): string[] | null => {
  const isUserLoaded = useUserStore(authSelectors.isLoaded);
  const userInterests = useUserStore(userProfileSelectors.interests);
  const { t, ready } = useTranslation('onboarding');

  return useMemo(() => {
    if (!isUserLoaded || !ready) return null;

    return userInterests.map((raw) => {
      const key = resolveInterestAreaKey(raw, (areaKey) => t(areaKey, { defaultValue: '' }));
      return key ?? raw.trim().toLocaleLowerCase();
    });
  }, [isUserLoaded, userInterests, t, ready]);
};
