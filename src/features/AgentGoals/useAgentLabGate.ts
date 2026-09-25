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
  const initFailed = useUserStore((s) => s.isUserStateInitError);
  const isPreferenceInit = useUserStore(preferenceSelectors.isPreferenceInit);
  const enabled = useUserStore(labPreferSelectors.enableTopicAcceptance);

  return useMemo(
    () => ({
      enabled,
      // A failed user-state init keeps the legacy escape: the route falls
      // through to its redirect instead of an endless skeleton.
      initFailed: initFailed !== undefined,
      isPreferenceInit,
      shouldRedirect: isPreferenceInit && !enabled,
    }),
    [enabled, initFailed, isPreferenceInit],
  );
};
