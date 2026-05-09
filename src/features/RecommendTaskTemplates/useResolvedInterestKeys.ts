import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { INTEREST_AREAS } from '@/routes/onboarding/config';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';
import { authSelectors } from '@/store/user/slices/auth/selectors';

/**
 * onboarding stores localized labels in `user.interests` (e.g. "内容创作",
 * "Content Creation") plus occasional freeform text. Resolve each entry back
 * to an INTEREST_AREAS key via the current-locale onboarding translations so
 * the server can intersection-match against template.interests (which hold
 * canonical keys). Unresolved entries are lowercased passthroughs — server
 * treats them as non-matching.
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
    const labelToKey = new Map<string, string>();
    for (const area of INTEREST_AREAS) {
      labelToKey.set(area.key, area.key);
      const translated = t(`interests.area.${area.key}`, { defaultValue: '' });
      if (translated) labelToKey.set(translated.trim().toLowerCase(), area.key);
    }
    return userInterests.map((raw) => {
      const k = raw.trim().toLowerCase();
      return labelToKey.get(k) ?? k;
    });
  }, [isUserLoaded, userInterests, t, ready]);
};
