import type { PartialDeep } from 'type-fest';
import { z } from 'zod';

import type { DeviceExecutionTarget } from '../agent/agencyConfig';
import type { Plans } from '../subscription';
import type { TopicGroupMode, TopicSortBy } from '../topic';
import type { UserAgentOnboarding } from './agentOnboarding';
import type { UserOnboarding } from './onboarding';
import type { UserSettings } from './settings';

/**
 * Per-agent override for the device execution decision.
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
 * Per-source-device device overrides for a single agent.
 * Key = sourceDeviceId of the physical machine the user is on
 * (gateway deviceId on desktop, localStorage anonymous ID on web).
 * `'*'` = fallback when no source-device-specific override exists.
 */
export type AgentDeviceOverridesBySource = Record<string, AgentDeviceOverride>;

/**
 * Per-user preferences that only make sense inside a specific workspace.
 *
 * Stored in its own DB table (`workspace_user_settings`, PK
 * `(workspace_id, user_id)`) — the workspace-scoped counterpart to
 * `user_settings`.
 */
export interface WorkspaceUserPreference {
  agentDeviceOverrides?: Record<string /* agentId */, AgentDeviceOverridesBySource>;
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
  moveSettingsToAvatar: z.boolean().optional(),
  topic: z.boolean().optional(),
  uploadFileInKnowledgeBase: z.boolean().optional(),
});

export type UserGuide = z.infer<typeof UserGuideSchema>;

export const UserLabSchema = z.object({
  enableAgentGraphConfig: z.boolean().optional(),
  enableAgentSelfIteration: z.boolean().optional(),
  enableClaudeCodeSdk: z.boolean().optional(),
  enableFleet: z.boolean().optional(),
  enableFoldFinishedTurn: z.boolean().optional(),
  enableGroupChat: z.boolean().optional(),
  enableImessage: z.boolean().optional(),
  enableInAppBrowser: z.boolean().optional(),
  enableInputMarkdown: z.boolean().optional(),
  enableMessageTextSelectionActions: z.boolean().optional(),
  enablePlatformAgent: z.boolean().optional(),
  enableTaskVerify: z.boolean().optional(),
});

export type UserLab = z.infer<typeof UserLabSchema>;

export interface UserPreference {
  defaultOpenInApp?: string;

  disableInputMarkdownRender?: boolean;

  guide?: UserGuide;
  hideSyncAlert?: boolean;
  lab?: UserLab;
  lastWorkspaceId?: string | null;
  /**
   * Per-agent per-source-device device overrides for personal agents.
   * Same structure as WorkspaceUserPreference.agentDeviceOverrides.
   * Persisted to `users.preference` JSONB column.
   */
  personalDeviceOverrides?: Record<string /* agentId */, AgentDeviceOverridesBySource>;
  telemetry?: boolean | null;
  topicGroupMode?: TopicGroupMode;
  topicIncludeCompleted?: boolean;
  topicSortBy?: TopicSortBy;
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
  isOnboard?: boolean;
  lastName?: string;
  onboarding?: UserOnboarding;
  preference: UserPreference;
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

export interface SSOProvider {
  email?: string;
  expiresAt?: Date | number | null;
  provider: string;
  providerAccountId: string;
}

const agentDeviceOverrideSchema = z.object({
  boundDeviceId: z.string().optional(),
  executionTarget: z.enum(['auto', 'device', 'local', 'none', 'sandbox']).optional(),
});

const agentDeviceOverridesBySourceSchema = z.record(z.string(), agentDeviceOverrideSchema);

export const UserPreferenceSchema = z
  .object({
    defaultOpenInApp: z.string().optional(),
    guide: UserGuideSchema.optional(),
    hideSyncAlert: z.boolean().optional(),
    lab: UserLabSchema.optional(),
    lastWorkspaceId: z.string().nullish(),
    personalDeviceOverrides: z.record(z.string(), agentDeviceOverridesBySourceSchema).optional(),
    telemetry: z.boolean().nullable(),
    topicGroupMode: z.enum(['byTime', 'byProject', 'flat', 'byStatus']).optional(),
    topicIncludeCompleted: z.boolean().optional(),
    topicSortBy: z.enum(['createdAt', 'updatedAt']).optional(),
    useCmdEnterToSend: z.boolean().optional(),
  })
  .partial();
