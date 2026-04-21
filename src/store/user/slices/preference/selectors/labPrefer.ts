import { DEFAULT_PREFERENCE } from '@lobechat/const';

import { type UserState } from '@/store/user/initialState';

export const labPreferSelectors = {
  enableGatewayMode: (s: UserState): boolean => s.preference.lab?.enableGatewayMode ?? false,
  enableHeterogeneousAgent: (s: UserState): boolean =>
    s.preference.lab?.enableHeterogeneousAgent ?? false,
  enableInputMarkdown: (s: UserState): boolean =>
    s.preference.lab?.enableInputMarkdown ?? DEFAULT_PREFERENCE.lab!.enableInputMarkdown!,
};
