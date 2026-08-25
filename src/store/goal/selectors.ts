import type { GoalStore } from './action';

const EMPTY_GOALS: GoalStore['goalListByAgentId'][string] = [];

const goalList = (agentId: string) => (s: GoalStore) => s.goalListByAgentId[agentId] ?? EMPTY_GOALS;

const isGoalListInitialized = (agentId: string) => (s: GoalStore) =>
  s.goalListInitializedAgentIds.includes(agentId);

const homeGoals = (scope: string) => (s: GoalStore) => s.homeGoalsByScope[scope] ?? EMPTY_GOALS;

const isHomeGoalsInitialized = (scope: string) => (s: GoalStore) =>
  s.homeGoalsInitializedScopes.includes(scope);

export const goalSelectors = {
  goalList,
  homeGoals,
  isGoalListInitialized,
  isHomeGoalsInitialized,
};
