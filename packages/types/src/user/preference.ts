import type { PartialDeep } from 'type-fest';
import { z } from 'zod';

import type { Plans } from '../subscription';
import { TopicDisplayMode } from '../topic';
import type { UserOnboarding } from './onboarding';
import type { UserSettings } from './settings';

export interface LobeUser {
  avatar?: string;
  email?: string | null;
  firstName?: string | null;
  fullName?: string | null;
  id: string;
  interests?: string[];
  latestName?: string | null;
  username?: string | null;
}

export const UserGuideSchema = z.object({
  /**
   * Move the settings button to the avatar dropdown
   */
  moveSettingsToAvatar: z.boolean().optional(),

  /**
   * Topic Guide
   */
  topic: z.boolean().optional(),

  /**
   * tell user that uploaded files can be found in knowledge base
   */
  uploadFileInKnowledgeBase: z.boolean().optional(),
});

export type UserGuide = z.infer<typeof UserGuideSchema>;

export const UserLabSchema = z.object({
  /**
   * enable multi-agent group chat mode
   */
  enableGroupChat: z.boolean().optional(),
  /**
   * enable markdown rendering in chat input editor
   */
  enableInputMarkdown: z.boolean().optional(),
});

export type UserLab = z.infer<typeof UserLabSchema>;

export interface UserPreference {
  /**
   * disable markdown rendering in chat input editor
   * @deprecated Use lab.enableInputMarkdown instead
   */
  disableInputMarkdownRender?: boolean;
  guide?: UserGuide;
  hideSyncAlert?: boolean;
  /**
   * lab experimental features
   */
  lab?: UserLab;
  /**
   * @deprecated Use settings.general.telemetry instead
   */
  telemetry?: boolean | null;
  topicDisplayMode?: TopicDisplayMode;
  /**
   * whether to use cmd + enter to send message
   */
  useCmdEnterToSend?: boolean;
}

export type ReferralStatusString = 'registered' | 'suspected' | 'rewarded' | 'revoked';

export interface UserInitializationState {
  avatar?: string;
  canEnablePWAGuide?: boolean;
  canEnableTrace?: boolean;
  email?: string;
  firstName?: string;
  fullName?: string;
  hasConversation?: boolean;
  interests?: string[];
  isFreePlan?: boolean;
  isInviteCodeRequired?: boolean;
  /** @deprecated Use onboarding field instead */
  isOnboard?: boolean;
  lastName?: string;
  onboarding?: UserOnboarding;
  preference: UserPreference;
  /**
   * Referral lifecycle status for the current user (invitee side).
   */
  referralStatus?: ReferralStatusString;
  settings: PartialDeep<UserSettings>;
  subscriptionPlan?: Plans;
  userId?: string;
  username?: string;
}

export const OAuthAccountSchema = z.object({
  provider: z.string(),
  providerAccountId: z.string(),
});

/**
 * SSO Provider info displayed in profile page
 */
export interface SSOProvider {
  email?: string;
  /** Expiration time - Date for better-auth */
  expiresAt?: Date | number | null;
  provider: string;
  providerAccountId: string;
}

export const UserPreferenceSchema = z
  .object({
    guide: UserGuideSchema.optional(),
    hideSyncAlert: z.boolean().optional(),
    lab: UserLabSchema.optional(),
    telemetry: z.boolean().nullable(),
    topicDisplayMode: z.nativeEnum(TopicDisplayMode).optional(),
    useCmdEnterToSend: z.boolean().optional(),
  })
  .partial();
