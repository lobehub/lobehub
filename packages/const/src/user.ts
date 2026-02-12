import type { UserPreference } from '@lobechat/types';
import { TopicDisplayMode } from '@lobechat/types';

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
    enableInputMarkdown: true,
  },
  topicDisplayMode: TopicDisplayMode.ByTime,
  useCmdEnterToSend: false,
};
