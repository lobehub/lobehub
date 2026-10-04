/** Goal page path, scoped to the goal's owning agent when it has one. */
export const goalDetailPath = (goalId: string, agentId?: string | null) =>
  agentId ? `/agent/${agentId}/goal/${goalId}` : `/goal/${goalId}`;
