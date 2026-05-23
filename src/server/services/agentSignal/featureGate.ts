import { INBOX_SESSION_ID } from '@lobechat/const';

import type { LobeChatDatabase } from '@/database/type';
import { getServerFeatureFlagsStateFromRuntimeConfig } from '@/server/featureFlags';

/**
 * Input used to resolve Agent Signal self-iteration capability.
 */
export interface AgentSelfIterationCapabilityInput {
  /**
   * Stored agent-level self-iteration setting.
   */
  agentSelfIterationEnabled?: boolean;
  /**
   * User-level rollout result from `enableAgentSelfIteration`.
   */
  isAgentSelfIterationFeatureEnabled: boolean;
  /**
   * Whether the agent is the product-owned Lobe AI agent.
   */
  isLobeAiAgent: boolean;
}

/**
 * Checks whether a slug belongs to Lobe AI.
 *
 * Use when:
 * - Agent Signal must special-case the product-owned default assistant
 * - Code must avoid treating every virtual/builtin agent as Lobe AI
 *
 * Expects:
 * - `slug` is the persisted agent slug or `undefined` when unavailable
 *
 * Returns:
 * - `true` only for the builtin inbox agent slug
 */
export const isLobeAiAgentSlug = (slug?: string | null) => slug === INBOX_SESSION_ID;

/**
 * Resolves whether one agent may run Agent Signal self-iteration.
 *
 * Use when:
 * - Server code has an agent context and must combine rollout with per-agent capability
 * - Lobe AI should be managed by feature flag instead of stored chat config
 *
 * Expects:
 * - `isAgentSelfIterationFeatureEnabled` already includes the user-level feature-flag result
 *
 * Returns:
 * - `true` for Lobe AI when the feature flag is enabled
 * - `true` for non-Lobe AI only when `agentSelfIterationEnabled` is true
 */
export const resolveAgentSelfIterationCapability = (input: AgentSelfIterationCapabilityInput) => {
  if (!input.isAgentSelfIterationFeatureEnabled) return false;

  if (input.isLobeAiAgent) return true;

  return input.agentSelfIterationEnabled === true;
};

/**
 * Resolves whether Agent Self-iteration is feature-flag enabled for the current user.
 *
 * Use when:
 * - UI or server code needs to know whether Agent Self-iteration can be used
 * - RuntimeConfig-backed feature flags are the source of truth for rollout eligibility
 *
 * Expects:
 * - `userId` belongs to the current authenticated user
 *
 * Returns:
 * - `true` only when the Agent Self-iteration feature flag is enabled for the user
 */
export const isAgentSelfIterationFeatureEnabledForUser = async (userId: string) => {
  const featureFlags = await getServerFeatureFlagsStateFromRuntimeConfig(userId);

  return featureFlags.enableAgentSelfIteration === true;
};

/**
 * Resolves whether Agent Signal execution is enabled for the current user.
 *
 * Use when:
 * - A server entrypoint needs to decide whether Agent Signal may execute
 * - RuntimeConfig-backed feature flags are the source of truth for rollout eligibility
 *
 * Expects:
 * - `userId` belongs to the current authenticated user
 *
 * Returns:
 * - `true` only when the Agent Self-iteration feature flag is enabled for the user
 */
export const isAgentSignalEnabledForUser = async (_db: LobeChatDatabase, userId: string) => {
  try {
    return await isAgentSelfIterationFeatureEnabledForUser(userId);
  } catch {
    return false;
  }
};
