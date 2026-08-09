import type { GoalStore } from './action';

const EMPTY_GOALS: GoalStore['goalListByAgentId'][string] = [];

const goalList = (agentId: string) => (s: GoalStore) => s.goalListByAgentId[agentId] ?? EMPTY_GOALS;

const isGoalListInitialized = (agentId: string) => (s: GoalStore) =>
  s.goalListInitializedAgentIds.includes(agentId);

const homeGoals = (s: GoalStore) => s.homeGoals;

const isHomeGoalsInitialized = (s: GoalStore) => s.isHomeGoalsInit;

export const goalSelectors = {
  goalList,
  homeGoals,
  isGoalListInitialized,
  isHomeGoalsInitialized,
};
