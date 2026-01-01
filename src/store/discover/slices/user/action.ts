import useSWR, { type SWRResponse } from 'swr';
import type { StateCreator } from 'zustand/vanilla';

import { discoverService } from '@/services/discover';
import { type DiscoverStore } from '@/store/discover';
import { globalHelpers } from '@/store/global/helpers';
import { type DiscoverUserProfile } from '@/types/discover';

export interface UserAction {
  useUserProfile: (params: { username: string }) => SWRResponse<DiscoverUserProfile | undefined>;
}

export const createUserSlice: StateCreator<
  DiscoverStore,
  [['zustand/devtools', never]],
  [],
  UserAction
> = () => ({
  useUserProfile: (params) => {
    const locale = globalHelpers.getCurrentLanguage();
    return useSWR(
      params.username ? ['user-profile', locale, params.username].join('-') : null,
      async () => discoverService.getUserInfo({ username: params.username }),
      {
        revalidateOnFocus: false,
      },
    );
  },
});
