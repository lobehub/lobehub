import { type SWRResponse } from 'swr';
import useSWR from 'swr';

import { discoverKeys } from '@/libs/swr/keys';
import { discoverService } from '@/services/discover';
import { type DiscoverStore } from '@/store/discover';
import { globalHelpers } from '@/store/global/helpers';
import { type StoreSetter } from '@/store/types';
import { type DiscoverUserProfile } from '@/types/discover';

type Setter = StoreSetter<DiscoverStore>;
export const createUserSlice = (set: Setter, get: () => DiscoverStore, _api?: unknown) =>
  new UserActionImpl(set, get, _api);

export class UserActionImpl {
  constructor(set: Setter, get: () => DiscoverStore, _api?: unknown) {
    void _api;
    void set;
    void get;
  }

  useUserProfile = (params: { username: string }): SWRResponse<DiscoverUserProfile | undefined> => {
    const locale = globalHelpers.getCurrentLanguage();
    return useSWR(
      params.username ? discoverKeys.userProfile(locale, params.username) : null,
      async () => discoverService.getUserInfo({ username: params.username }),
      {
        revalidateOnFocus: false,
      },
    );
  };
}

export type UserAction = Pick<UserActionImpl, keyof UserActionImpl>;
