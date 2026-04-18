import type { UserPreference } from '@lobechat/types';

/**
 * Current onboarding flow version.
 * Increment this value when the onboarding flow changes significantly,
 * which will trigger existing users to go through onboarding again.
 */
export const CURRENT_ONBOARDING_VERSION = 1;

const DEFAULT_TOPIC_DISPLAY_MODE = 'byUpdatedTime' as NonNullable<
  UserPreference['topicDisplayMode']
>;

export const DEFAULT_PREFERENCE: UserPreference = {
  guide: {
    moveSettingsToAvatar: true,
    topic: true,
  },
  lab: {
    enableHeterogeneousAgent: false,
    enableInputMarkdown: true,
  },
  topicDisplayMode: DEFAULT_TOPIC_DISPLAY_MODE,
  useCmdEnterToSend: false,
};
