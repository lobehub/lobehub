import type { UserPreference } from '@lobechat/types';

import { UserModel } from '@/database/models/user';
import type { LobeChatDatabase } from '@/database/type';
import { getServerFeatureFlagsStateFromRuntimeConfig } from '@/server/featureFlags';

/**
 * Resolves whether Agent Self-iteration should be exposed in Labs for the current user.
 *
 * Use when:
 * - UI or server code needs to know whether the Agent Self-iteration Lab toggle should exist
 * - RuntimeConfig-backed feature flags are the source of truth for rollout eligibility
 *
 * Expects:
 * - `userId` belongs to the current authenticated user
 *
 * Returns:
 * - `true` only when the Agent Self-iteration feature flag is enabled for the user
 */
export const canShowAgentSignalLab = async (userId: string) => {
  const featureFlags = await getServerFeatureFlagsStateFromRuntimeConfig(userId);

  return featureFlags.enableAgentSelfIteration === true;
};

/**
 * Resolves whether Agent Signal execution is enabled for the current user.
 *
 * Use when:
 * - A server entrypoint needs to decide whether Agent Signal may execute
 * - Both rollout eligibility and user opt-in must be enforced together
 *
 * Expects:
 * - `db` and `userId` point at the same authenticated user context
 *
 * Returns:
 * - `true` only when the feature flag is enabled and the user enabled the Lab switch
 */
export const isAgentSignalEnabledForUser = async (db: LobeChatDatabase, userId: string) => {
  try {
    const [featureFlagEnabled, preference] = await Promise.all([
      canShowAgentSignalLab(userId),
      new UserModel(db, userId).getUserPreference(),
    ]);

    return featureFlagEnabled && isAgentSelfIterationLabEnabled(preference);
  } catch {
    return false;
  }
};

const isAgentSelfIterationLabEnabled = (preference?: UserPreference) => {
  return preference?.lab?.enableAgentSelfIteration === true;
};
