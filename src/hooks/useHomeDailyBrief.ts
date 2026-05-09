import { useCallback, useSyncExternalStore } from 'react';

import { useClientDataSWR } from '@/libs/swr';
import { homeService } from '@/services/home';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

const FETCH_HOME_DAILY_BRIEF_KEY = 'fetchHomeDailyBrief';

interface HomeDailyBriefPair {
  hint: string;
  welcome: string;
}

interface UseHomeDailyBriefResult {
  /** Index advancer — call from the typewriter's `onSentenceComplete`. */
  advance: () => void;
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

  const { data } = useClientDataSWR(isLogin ? FETCH_HOME_DAILY_BRIEF_KEY : null, () =>
    homeService.getDailyBrief(),
  );

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
    currentPair: pairs[safeIndex],
    pairs,
  };
};
