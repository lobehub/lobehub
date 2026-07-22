import type { PartialDeep } from 'type-fest';
import { z } from 'zod';

import type { DeviceExecutionTarget } from '../agent/agencyConfig';
import type { AgentModelOverride } from '../agent/modelSelection';
import type { Plans } from '../subscription';
import type { TopicGroupMode, TopicSortBy } from '../topic';
import type { UserAgentOnboarding } from './agentOnboarding';
import type { UserOnboarding } from './onboarding';
import type { UserSettings } from './settings';

/**
 * Per-agent override for the device execution decision. Stored on
 * `workspace_user_settings.preference.agentDeviceOverrides` (see
 * {@link WorkspaceUserPreference}) and merged over `agents.agencyConfig` at
 * read time so each workspace member's Cloud Sandbox / workspace-device /
 * local-machine choice is independent — one member's pick never traps
 * another. See `resolveAgencyConfig` in
 * `packages/types/src/agent/agencyConfig.ts` for the merge implementation.
 *
 * Two fields only, deliberately: `executionTarget` + `boundDeviceId`.
 * `heterogeneousProvider`, `verifyRubricId`, and `workingDirByDevice` remain
 * agent-shared because they describe *what the agent is*, not *how this user
 * routes it*.
 */
export interface AgentDeviceOverride {
  boundDeviceId?: string;
  executionTarget?: DeviceExecutionTarget;
}

/**
 * Per-user preferences that only make sense inside a specific workspace.
 *
 * Stored in its own DB table (`workspace_user_settings`, PK
 * `(workspace_id, user_id)`) — the workspace-scoped counterpart to
 * `user_settings`. The dedicated table lets:
 *   - workspace / user delete cascade take out every trace in one shot;
 *   - member-list queries stay leak-free (they hit `workspace_members`, not
 *     this table);
 *   - the "workspace-scoped user preference" boundary be obvious at the
 *     schema layer.
 *
 * A single jsonb `preference` column holds this shape today (matches how
 * `users.preference` scales); if a future family grows large enough to
 * deserve its own column (à la `user_settings.hotkey` / `user_settings.tts`),
 * split it out at that point.
 */
export interface WorkspaceUserPreference {
  agentDeviceOverrides?: Record<string /* agentId */, AgentDeviceOverride>;
  /** Personal model choices for workspace agents that allow member selection. */
  agentModelOverrides?: Record<string /* agentId */, AgentModelOverride>;
}

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
   * enable graph runtime configuration for agents
   */
  enableAgentGraphConfig: z.boolean().optional(),
  /**
   * enable agent self-iteration feedback capture and policy execution
   */
  enableAgentSelfIteration: z.boolean().optional(),
  /**
   * enable artifact deployment features (publish artifacts to a hosted URL)
   */
  enableArtifactDeployment: z.boolean().optional(),
  /**
   * run Claude Code hetero sessions through the Claude Agent SDK instead of CLI spawn
   */
  enableClaudeCodeSdk: z.boolean().optional(),
  /**
   * one-click import of local Claude Code / Codex CLI sessions as topics (desktop only)
   */
  enableHeteroSessionImport: z.boolean().optional(),
  /**
   * enable multi-agent group chat mode
   */
  enableGroupChat: z.boolean().optional(),
  /**
   * enable the iMessage channel (BlueBubbles Desktop bridge)
   */
  enableImessage: z.boolean().optional(),
  /**
   * show the in-app Browser tab in the conversation WorkingSidebar (desktop only)
   */
  enableInAppBrowser: z.boolean().optional(),
  /**
   * enable markdown rendering in chat input editor
   */
  enableInputMarkdown: z.boolean().optional(),
  /**
   * enable selecting message text and adding it to the next conversation context
   */
  enableMessageTextSelectionActions: z.boolean().optional(),
  /**
   * show OAuth app management in personal and workspace settings
   */
  enableOAuthApps: z.boolean().optional(),
  /**
   * show the "Add Platform Agent" entry in the create menu
   */
  enablePlatformAgent: z.boolean().optional(),
  /**
   * enable the task delivery-acceptance (verify) config UI on the task detail
   */
  enableTaskVerify: z.boolean().optional(),
  /**
   * enable the per-topic acceptance tray above the composer (author a topic's
   * delivery checklist inline)
   */
  enableTopicAcceptance: z.boolean().optional(),
});

export type UserLab = z.infer<typeof UserLabSchema>;

export interface UserPreference {
  /** Last-used app for "Open working directory in…" split button. Empty/unknown values fall back to platform default. */
  defaultOpenInApp?: string;
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
   * Last active workspace id. Used on cloud to land the user back in the
   * workspace they last used when they open `/` — `null` means personal
   * context. Stored as id (not slug) so workspace renames don't invalidate it.
   */
  lastWorkspaceId?: string | null;
  /**
   * @deprecated Use settings.general.telemetry instead
   */
  telemetry?: boolean | null;
  /**
   * CSS font-family value used by the desktop built-in terminal.
   * Empty or whitespace-only values fall back to the application code font.
   */
  terminalFontFamily?: string;
  topicGroupMode?: TopicGroupMode;
  /**
   * whether to include completed topics in the topic list
   */
  topicIncludeCompleted?: boolean;
  topicSortBy?: TopicSortBy;
  /**
   * whether to use cmd + enter to send message
   */
  useCmdEnterToSend?: boolean;
}

export type ReferralStatusString =
  'pending_reward' | 'registered' | 'suspected' | 'rewarded' | 'revoked';

export interface UserInitializationState {
  agentOnboarding?: UserAgentOnboarding;
  avatar?: string;
  canEnablePWAGuide?: boolean;
  canEnableTrace?: boolean;
  email?: string;
  firstName?: string;
  fullName?: string;
  hasConversation?: boolean;
  interests?: string[];
  isFreePlan?: boolean;
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
    defaultOpenInApp: z.string().optional(),
    guide: UserGuideSchema.optional(),
    hideSyncAlert: z.boolean().optional(),
    lab: UserLabSchema.optional(),
    lastWorkspaceId: z.string().nullish(),
    terminalFontFamily: z.string().optional(),
    telemetry: z.boolean().nullable(),
    topicGroupMode: z.enum(['byTime', 'byProject', 'flat', 'byStatus']).optional(),
    topicIncludeCompleted: z.boolean().optional(),
    topicSortBy: z.enum(['createdAt', 'updatedAt']).optional(),
    useCmdEnterToSend: z.boolean().optional(),
  })
  .partial();
