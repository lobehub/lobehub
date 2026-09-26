'use client';

import { useMemo } from 'react';

import { useUserStore } from '@/store/user';
import { labPreferSelectors, preferenceSelectors } from '@/store/user/selectors';

/**
 * The lab gate every `/agent/:aid/goal*` route sits behind.
 *
 * `enableTopicAcceptance` reads `preference.lab`, which is `false` until
 * `useInitUserState` resolves. Judging the gate before that settles renders a
 * white flash (`null` for the whole pane) and the redirect effect kicks
 * cold-boot visitors back to chat before their preference ever arrived.
 * `isPreferenceInit` splits "still loading" from "settled off", and a failed
 * user-state init keeps the legacy escape instead of an endless skeleton.
 */
export const useAgentLabGate = () => {
  const initError = useUserStore((s) => s.isUserStateInitError);
  const isPreferenceInit = useUserStore(preferenceSelectors.isPreferenceInit);
  const enabled = useUserStore(labPreferSelectors.enableTopicAcceptance);

  const initFailed = !!initError;

  return useMemo(
    () => ({
      enabled,
      // A failed user-state init keeps the legacy escape: the route falls
      // through to its redirect instead of an endless skeleton.
      initFailed,
      isPreferenceInit,
      // A failed init never settles the preference, so the gate stays
      // unjudgeable forever. `shouldRedirect` is what actually gets the
      // visitor out, so it must fire here too — without it the route skips the
      // skeleton and then renders `null`, leaving an empty pane with no exit.
      shouldRedirect: (isPreferenceInit || initFailed) && !enabled,
    }),
    [enabled, initFailed, isPreferenceInit],
  );
};
