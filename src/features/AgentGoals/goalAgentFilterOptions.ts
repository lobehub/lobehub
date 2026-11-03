interface GoalWithAgent {
  goal: { agentId?: string | null };
}

export interface GoalAgentFilterOption {
  agentId: string;
  count: number;
}

/**
 * The agents the cross-agent goals page can be narrowed to: every agent that
 * owns a goal in the loaded list, in the order they first appear (newest goal
 * first), with how many goals each owns there. Goals with no agent (created
 * from a project page) have nothing to filter by and are left out.
 */
export const goalAgentFilterOptions = (goals: GoalWithAgent[]): GoalAgentFilterOption[] => {
  const counts = new Map<string, number>();
  for (const { goal } of goals) {
    if (!goal.agentId) continue;
    counts.set(goal.agentId, (counts.get(goal.agentId) ?? 0) + 1);
  }
  return [...counts].map(([agentId, count]) => ({ agentId, count }));
};

/**
 * The options whose agent name contains the search text, case-insensitively.
 * An empty search keeps every option.
 */
export const matchGoalAgentFilterOptions = (
  options: GoalAgentFilterOption[],
  titles: Record<string, string>,
  search: string,
): GoalAgentFilterOption[] => {
  const query = search.trim().toLowerCase();
  if (!query) return options;
  return options.filter(({ agentId }) => (titles[agentId] ?? '').toLowerCase().includes(query));
};
