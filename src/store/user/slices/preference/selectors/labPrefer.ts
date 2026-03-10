import { DEFAULT_PREFERENCE } from '@lobechat/const';

import { type UserState } from '@/store/user/initialState';

export const labPreferSelectors = {
  enableInputMarkdown: (s: UserState): boolean =>
    s.preference.lab?.enableInputMarkdown ?? DEFAULT_PREFERENCE.lab!.enableInputMarkdown!,
};
