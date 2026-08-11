import type { HomeDailyBriefPair } from '@lobechat/types';

import { useHomeDailyBriefData } from '@/projection';
import { useUserStore } from '@/store/user';
import { authSelectors, userProfileSelectors } from '@/store/user/selectors';

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
  // session never serves the previous user's pairs. The server remains the
  // owner of Daily Brief date semantics; the entity layer preserves that data
  // as a typed snapshot without adding a client-side date partition.
  const { data } = useHomeDailyBriefData(isLogin, userId);

  const pairs = data?.pairs ?? [];

  return {
    currentPair: pairs[0],
    pairs,
  };
};
