import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { INTEREST_AREAS } from '@/routes/onboarding/config';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

/**
 * onboarding stores localized labels in `user.interests` (e.g. "内容创作",
 * "Content Creation") plus occasional freeform text. Resolve each entry back
 * to an INTEREST_AREAS key via the current-locale onboarding translations so
 * the server can intersection-match against template.interests (which hold
 * canonical keys). Unresolved entries are lowercased passthroughs — server
 * treats them as non-matching.
 *
 * Returns `null` while the onboarding namespace is still loading (it's lazy-
 * loaded, not in the startup bundle). Without this gate, the first render
 * would resolve all localized labels to passthrough strings, fire an SWR
 * request with the wrong keys, and get back a fallback list — then re-fire
 * once the namespace lands. Callers should keep SWR disabled while null.
 */
export const useResolvedInterestKeys = (): string[] | null => {
  const userInterests = useUserStore(userProfileSelectors.interests);
  const { t, ready } = useTranslation('onboarding');

  return useMemo(() => {
    if (!ready) return null;
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
  }, [userInterests, t, ready]);
};
