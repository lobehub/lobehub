/**
 * The agent the verify card should have selected. A list restored from the
 * local copy may still hold agents that were removed since, so nothing is
 * chosen from it: only a server-confirmed list picks the default (inbox is
 * pinned first) or drops a pick that is no longer in it.
 */
export const resolveDefaultAgentId = (
  agents: { id: string }[] | undefined,
  isConfirmed: boolean,
  selectedAgentId: string | undefined,
): string | undefined => {
  if (!isConfirmed || !agents) return selectedAgentId;
  if (selectedAgentId && agents.some((agent) => agent.id === selectedAgentId))
    return selectedAgentId;
  return agents[0]?.id;
};
