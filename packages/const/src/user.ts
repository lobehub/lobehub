import type { UserPreference } from '@lobechat/types';

/**
 * Current onboarding flow version.
 * Increment this value when the onboarding flow changes significantly,
 * which will trigger existing users to go through onboarding again.
 */
export const CURRENT_ONBOARDING_VERSION = 1;

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
    enablePlatformAgent: false,
  },
  topicGroupMode: 'byTime',
  topicIncludeCompleted: false,
  topicSortBy: 'updatedAt',
  useCmdEnterToSend: false,
};
