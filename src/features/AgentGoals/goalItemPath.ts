interface GoalItemPathOptions {
  /** The row's agent: the route's agent first, then the goal's own. */
  agentId?: string | null;
  /** The row sits on the cross-agent list. */
  crossAgent?: boolean;
  goalId: string;
}

/**
 * Where a goal-list row opens. The cross-agent list keeps the user in the
 * workspace on the bare route, the way the global task list does; elsewhere a
 * goal with an agent opens under that agent, and an agent-less one (created
 * from a project page) falls back to the bare route.
 */
export const goalItemPath = ({ agentId, crossAgent, goalId }: GoalItemPathOptions): string =>
  agentId && !crossAgent ? `/agent/${agentId}/goal/${goalId}` : `/goal/${goalId}`;
