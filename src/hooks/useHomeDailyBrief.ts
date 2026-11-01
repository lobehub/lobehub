import { useHomeStore } from '@/store/home';
import { homeInboxSelectors } from '@/store/home/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

interface HomeDailyBriefPair {
  hint: string;
  welcome: string;
}

interface UseHomeDailyBriefResult {
  /** First pair selected for this daily brief. `undefined` when no data. */
  currentPair: HomeDailyBriefPair | undefined;
  /** All paired entries from the daily-cron generator. */
  pairs: HomeDailyBriefPair[];
}

const EMPTY: HomeDailyBriefPair[] = [];

/**
 * The brief is a replica partitioned by the cache scope (user + workspace), so
 * an account switch never serves the previous user's pairs, and a reload shows
 * the last pairs on the first frame while the server confirms them.
 */
export const useHomeDailyBrief = (): UseHomeDailyBriefResult => {
  const isLogin = useUserStore(authSelectors.isLogin);

  useHomeStore((s) => s.useFetchHomeDailyBrief)(isLogin);
  const pairs = useHomeStore(homeInboxSelectors.dailyBrief)?.pairs ?? EMPTY;

  return {
    currentPair: pairs[0],
    pairs,
  };
};
