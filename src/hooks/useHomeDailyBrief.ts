import { useClientDataSWR } from '@/libs/swr';
import { homeKeys } from '@/libs/swr/keys';
import { homeService } from '@/services/home';
import { useUserStore } from '@/store/user';
import { authSelectors, userProfileSelectors } from '@/store/user/selectors';

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

export const useHomeDailyBrief = (): UseHomeDailyBriefResult => {
  const isLogin = useUserStore(authSelectors.isLogin);
  const userId = useUserStore(userProfileSelectors.userId);

  // Scope the SWR key by userId so an account switch within the same SPA
  // session (or signing in as a different user after sign-out) refetches
  // and never serves the previous user's cached pairs from this slot.
  const { data } = useClientDataSWR(isLogin && userId ? homeKeys.dailyBrief(userId) : null, () =>
    homeService.getDailyBrief(),
  );

  const pairs = data?.pairs ?? [];

  return {
    currentPair: pairs[0],
    pairs,
  };
};
