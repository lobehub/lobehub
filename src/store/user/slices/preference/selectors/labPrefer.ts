import { DEFAULT_PREFERENCE } from '@lobechat/const';

import { type UserState } from '@/store/user/initialState';

export const labPreferSelectors = {
  enableAgentGraphConfig: (s: UserState): boolean =>
    s.preference.lab?.enableAgentGraphConfig ??
    DEFAULT_PREFERENCE.lab?.enableAgentGraphConfig ??
    false,
  enableAgentSelfIteration: (s: UserState): boolean =>
    s.preference.lab?.enableAgentSelfIteration ?? false,
  enableFleet: (s: UserState): boolean => s.preference.lab?.enableFleet ?? false,
  enableFoldFinishedTurn: (s: UserState): boolean =>
    s.preference.lab?.enableFoldFinishedTurn ?? false,
  enableImessage: (s: UserState): boolean => s.preference.lab?.enableImessage ?? false,
  enableInputMarkdown: (s: UserState): boolean =>
    s.preference.lab?.enableInputMarkdown ?? DEFAULT_PREFERENCE.lab?.enableInputMarkdown ?? true,
  enableMessageTextSelectionActions: (s: UserState): boolean =>
    s.preference.lab?.enableMessageTextSelectionActions ??
    DEFAULT_PREFERENCE.lab?.enableMessageTextSelectionActions ??
    false,
  enablePlatformAgent: (s: UserState): boolean => s.preference.lab?.enablePlatformAgent ?? false,
  enableTaskVerify: (s: UserState): boolean => s.preference.lab?.enableTaskVerify ?? false,
};
