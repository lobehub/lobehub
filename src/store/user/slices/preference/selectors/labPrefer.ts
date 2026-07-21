import { DEFAULT_PREFERENCE } from '@lobechat/const';

import { type UserState } from '@/store/user/initialState';

export const labPreferSelectors = {
  enableAgentGraphConfig: (s: UserState): boolean =>
    s.preference.lab?.enableAgentGraphConfig ??
    DEFAULT_PREFERENCE.lab?.enableAgentGraphConfig ??
    false,
  enableAgentSelfIteration: (s: UserState): boolean =>
    s.preference.lab?.enableAgentSelfIteration ?? false,
  enableArtifactDeployment: (s: UserState): boolean =>
    s.preference.lab?.enableArtifactDeployment ?? false,
  enableBuiltinTerminal: (s: UserState): boolean =>
    s.preference.lab?.enableBuiltinTerminal ?? false,
  enableClaudeCodeSdk: (s: UserState): boolean => s.preference.lab?.enableClaudeCodeSdk ?? false,
  enableImessage: (s: UserState): boolean => s.preference.lab?.enableImessage ?? false,
  enableInAppBrowser: (s: UserState): boolean => s.preference.lab?.enableInAppBrowser ?? false,
  enableInputMarkdown: (s: UserState): boolean =>
    s.preference.lab?.enableInputMarkdown ?? DEFAULT_PREFERENCE.lab?.enableInputMarkdown ?? true,
  enableMessageTextSelectionActions: (s: UserState): boolean =>
    s.preference.lab?.enableMessageTextSelectionActions ??
    DEFAULT_PREFERENCE.lab?.enableMessageTextSelectionActions ??
    false,
  enableOAuthApps: (s: UserState): boolean => s.preference.lab?.enableOAuthApps ?? false,
  enablePlatformAgent: (s: UserState): boolean => s.preference.lab?.enablePlatformAgent ?? false,
  enableTaskVerify: (s: UserState): boolean => s.preference.lab?.enableTaskVerify ?? false,
  enableTopicAcceptance: (s: UserState): boolean =>
    s.preference.lab?.enableTopicAcceptance ?? false,
};
