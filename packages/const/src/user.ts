import type { UserPreference } from '@lobechat/types';

export const CURRENT_ONBOARDING_VERSION = 2;

export const DEFAULT_PREFERENCE: UserPreference = {
  guide: {
    moveSettingsToAvatar: true,
    topic: true,
  },
  lab: {
    enableAgentGraphConfig: false,
    enableAgentSelfIteration: false,
    enableInputMarkdown: true,
    enableMessageTextSelectionActions: false,
    enableOAuthApps: false,
  },
  topicGroupMode: 'byTime',
  topicIncludeCompleted: false,
  topicSortBy: 'updatedAt',
  useCmdEnterToSend: false,
};
