/**
 * Module-level singleton for pending repo selections.
 *
 * When a user selects GitHub repos before sending the first message (no topic
 * exists yet), the selections are buffered here keyed by agentId. As soon as
 * the server creates a topic for that agent, gateway.ts consumes these repos
 * and writes them into the topic metadata immediately — avoiding the race
 * condition where the update would be attempted before the created topic had
 * appeared in the canonical Topic Projection.
 *
 * Desktop builds: CloudRepoSwitcher is never rendered, so these functions are
 * never called and the map stays empty.
 */

const map = new Map<string, string[]>();

/** Record pending repos for an agent (overwrites previous value). */
export const setPendingTopicRepos = (agentId: string, repos: string[]): void => {
  if (repos.length === 0) map.delete(agentId);
  else map.set(agentId, [...repos]);
};

/**
 * Consume and return pending repos for an agent.
 * Clears the entry so a second call returns [].
 */
export const consumePendingTopicRepos = (agentId: string): string[] => {
  const repos = map.get(agentId);
  map.delete(agentId);
  return repos ?? [];
};

/** Read pending repos without consuming them (for display). */
export const getPendingTopicRepos = (agentId: string): string[] => map.get(agentId) ?? [];
