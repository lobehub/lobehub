import { DEFAULT_PREFERENCE } from '@lobechat/const';

import { type UserState } from '@/store/user/initialState';

export const labPreferSelectors = {
  enableAgentDocumentFloatingChatPanel: (s: UserState): boolean =>
    s.preference.lab?.enableAgentDocumentFloatingChatPanel ??
    DEFAULT_PREFERENCE.lab?.enableAgentDocumentFloatingChatPanel ??
    false,
  enableAgentSelfIteration: (s: UserState): boolean =>
    s.preference.lab?.enableAgentSelfIteration ?? false,
  enableExecutionDeviceSwitcher: (s: UserState): boolean =>
    s.preference.lab?.enableExecutionDeviceSwitcher ?? false,
  enableGatewayMode: (s: UserState): boolean => s.preference.lab?.enableGatewayMode ?? false,
  enableInputMarkdown: (s: UserState): boolean =>
    s.preference.lab?.enableInputMarkdown ?? DEFAULT_PREFERENCE.lab?.enableInputMarkdown ?? true,
  enablePlatformAgent: (s: UserState): boolean => s.preference.lab?.enablePlatformAgent ?? false,
};
