import { getServerFeatureFlagsStateFromRuntimeConfig } from '@/server/featureFlags';

/**
 * Resolves whether the queue worker may run consecutive steps of an operation
 * inside a single invocation.
 *
 * Use when:
 * - The QStash step worker is deciding how much of an operation to run
 * - Rollout eligibility must come from RuntimeConfig rather than a deploy
 *
 * Expects:
 * - `userId` is the owner of the operation being stepped
 *
 * Returns:
 * - `true` only when the inline-step flag is enabled for that user
 *
 * Fails closed: any error resolving the flag falls back to the one-step-per-
 * delivery behaviour the worker has always had.
 */
export const isInlineAgentStepsEnabledForUser = async (userId: string): Promise<boolean> => {
  try {
    const featureFlags = await getServerFeatureFlagsStateFromRuntimeConfig(userId);

    return featureFlags.enableInlineAgentSteps === true;
  } catch {
    return false;
  }
};
