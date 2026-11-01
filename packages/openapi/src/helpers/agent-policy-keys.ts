import { AGENT_PERMISSION_POLICY_KEYS } from '@lobechat/types';

/**
 * Keep the member permission policies of an agent's `agencyConfig` when the
 * public API clears the column.
 *
 * `PATCH /api/v1/agents/:id` authorizes on `AGENT_UPDATE`, a scope workspace
 * Admins hold for every member's agent, while writing these keys is reserved
 * to the agent's creator and the workspace primary owner. The request schema
 * cannot express them either way, so an `agencyConfig: null` from an Admin that
 * dropped them would be a way around that gate rather than a caller clearing
 * their own settings — for `topicSharePolicy` it would resolve back to `member`
 * and reopen a restricted agent's topics to the whole workspace.
 *
 * Call this only for a caller who may NOT write the policies; an authorized
 * creator or primary owner clears the column outright, exactly as before.
 *
 * Returns `null` when nothing needs keeping, so the column still clears in the
 * ordinary case.
 */
export const retainAgentPermissionPolicies = (
  existing: unknown,
): Record<string, unknown> | null => {
  const stored = (existing as Record<string, unknown>) ?? {};
  const retained: Record<string, unknown> = {};

  for (const key of AGENT_PERMISSION_POLICY_KEYS) {
    if (key in stored) retained[key] = stored[key];
  }

  return Object.keys(retained).length > 0 ? retained : null;
};

/**
 * What `agencyConfig` becomes when a `PATCH` clears the column.
 *
 * A caller who may write the policies gets the clear they asked for; anyone
 * else keeps them — see {@link retainAgentPermissionPolicies} for why.
 */
export const resolveClearedAgencyConfig = (
  existing: unknown,
  canWritePolicies: boolean,
): Record<string, unknown> | null =>
  canWritePolicies ? null : retainAgentPermissionPolicies(existing);
