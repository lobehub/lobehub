import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';

import { useClientDataSWR } from '@/libs/swr';
import { homeService } from '@/services/home';
import { useUserStore } from '@/store/user';
import { authSelectors, userProfileSelectors } from '@/store/user/selectors';

const FETCH_HOME_DAILY_BRIEF_KEY = 'fetchHomeDailyBrief';

interface HomeDailyBriefPair {
  hint: string;
  welcome: string;
}

interface UseHomeDailyBriefResult {
  /** Index advancer — call from the typewriter's `onSentenceComplete`. */
  advance: () => void;
  /**
   * Index of the current pair within `pairs`. `0` when there is no data.
   * Exposed so consumers can drive a controlled typewriter — keeping the
   * welcome text and input hint paired across remounts.
   */
  currentIndex: number;
  /** Currently displayed pair (welcome + hint). `undefined` when no data. */
  currentPair: HomeDailyBriefPair | undefined;
  /** All paired entries from the daily-cron generator. */
  pairs: HomeDailyBriefPair[];
}

// Module-level shared state so WelcomeText and InputArea see the same rotating
// index without going through React context. The typewriter in WelcomeText
// owns the cadence (via `onSentenceComplete`); InputArea just observes.
let currentIndex = 0;
const listeners = new Set<() => void>();

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

const setCurrentIndex = (next: number) => {
  if (next === currentIndex) return;
  currentIndex = next;
  for (const cb of listeners) cb();
};

export const useHomeDailyBrief = (): UseHomeDailyBriefResult => {
  const isLogin = useUserStore(authSelectors.isLogin);
  const userId = useUserStore(userProfileSelectors.userId);

  // Scope the SWR key by userId so an account switch within the same SPA
  // session (or signing in as a different user after sign-out) refetches
  // and never serves the previous user's cached pairs from this slot.
  const { data } = useClientDataSWR(
    isLogin && userId ? [FETCH_HOME_DAILY_BRIEF_KEY, userId] : null,
    () => homeService.getDailyBrief(),
  );

  // Reset the module-level rotation when the user changes — otherwise the
  // new user inherits the previous user's offset (wrong starting pair).
  const lastSeenUserIdRef = useRef<string | undefined>(userId);
  useEffect(() => {
    if (lastSeenUserIdRef.current === userId) return;
    lastSeenUserIdRef.current = userId;
    setCurrentIndex(0);
  }, [userId]);

  const pairs = data?.pairs ?? [];

  const index = useSyncExternalStore(
    subscribe,
    () => currentIndex,
    () => 0,
  );

  const safeIndex = pairs.length === 0 ? 0 : index % pairs.length;

  const advance = useCallback(() => {
    if (pairs.length === 0) return;
    setCurrentIndex((currentIndex + 1) % pairs.length);
  }, [pairs.length]);

  return {
    advance,
    currentIndex: safeIndex,
    currentPair: pairs[safeIndex],
    pairs,
  };
};
