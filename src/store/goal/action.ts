import { mutate, useClientDataSWR } from '@/libs/swr';
import { taskKeys } from '@/libs/swr/keys';
import { taskService } from '@/services/task';
import type { StoreSetter } from '@/store/types';

import type { GoalListFilter, GoalState, GoalViewMode } from './initialState';

const GOAL_STATUSES = [
  'backlog',
  'running',
  'scheduled',
  'paused',
  'completed',
  'failed',
  'canceled',
];

/**
 * The home roll-up reads goals across every agent, so it asks for more than one
 * agent's page would need — the rail only shows the open ones, and those are a
 * fraction of the set once a workspace has history.
 */
const HOME_GOAL_FETCH_LIMIT = 100;

export type GoalStore = GoalState & GoalAction;
type Setter = StoreSetter<GoalStore>;

export class GoalActionImpl {
  readonly #get: () => GoalStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => GoalStore, _api?: unknown) {
    void _api;
    this.#get = get;
    this.#set = set;
  }

  deleteGoal = async (agentId: string, goalId: string): Promise<void> => {
    await taskService.deleteGoal(goalId);
    const current = this.#get().goalListByAgentId[agentId] ?? [];
    this.#set(
      ({ goalListByAgentId }) => ({
        goalListByAgentId: {
          ...goalListByAgentId,
          [agentId]: current.filter(({ id, identifier }) => id !== goalId && identifier !== goalId),
        },
      }),
      false,
      'deleteGoal/success',
    );
    await this.refreshGoals(agentId);
  };

  loadMoreGoals = (): void => {
    this.#set(
      ({ goalListVisibleLimit }) => ({ goalListVisibleLimit: goalListVisibleLimit + 10 }),
      false,
      'loadMoreGoals',
    );
  };

  refreshGoals = async (agentId: string): Promise<void> => {
    await mutate(taskKeys.sidebarGroups(`${agentId}:goals-page`));
  };

  refreshHomeGoals = async (scope: string): Promise<void> => {
    await mutate(taskKeys.homeGoals(scope));
  };

  setGoalListFilter = (filter: GoalListFilter): void => {
    this.#set({ goalListFilter: filter, goalListVisibleLimit: 10 }, false, 'setGoalListFilter');
  };

  setGoalViewMode = (mode: GoalViewMode): void => {
    this.#set({ goalViewMode: mode }, false, 'setGoalViewMode');
  };

  useFetchGoals = (agentId?: string) =>
    useClientDataSWR(
      agentId ? taskKeys.sidebarGroups(`${agentId}:goals-page`) : null,
      () =>
        taskService.groupList({
          assigneeAgentId: agentId,
          groups: [{ key: 'goals', limit: 100, statuses: GOAL_STATUSES }],
          hasGoal: true,
          parentTaskId: null,
        }),
      {
        onSuccess: ({ data }) => {
          this.#set(
            ({ goalListByAgentId, goalListInitializedAgentIds }) => ({
              goalListByAgentId: {
                ...goalListByAgentId,
                [agentId!]: data[0]?.tasks ?? [],
              },
              goalListInitializedAgentIds: goalListInitializedAgentIds.includes(agentId!)
                ? goalListInitializedAgentIds
                : [...goalListInitializedAgentIds, agentId!],
            }),
            false,
            'useFetchGoals/success',
          );
        },
        revalidateOnFocus: true,
      },
    );

  /**
   * Every agent's goals in one read — the home rail is a cross-agent roll-up,
   * so it cannot go through the per-agent list. Same server query minus the
   * assignee filter; the rail buckets and truncates client-side.
   */
  useFetchHomeGoals = (enabled: boolean, scope: string) =>
    useClientDataSWR(
      enabled ? taskKeys.homeGoals(scope) : null,
      () =>
        taskService.groupList({
          groups: [{ key: 'goals', limit: HOME_GOAL_FETCH_LIMIT, statuses: GOAL_STATUSES }],
          hasGoal: true,
          parentTaskId: null,
        }),
      {
        onSuccess: ({ data }) => {
          this.#set(
            { homeGoals: data[0]?.tasks ?? [], isHomeGoalsInit: true },
            false,
            'useFetchHomeGoals/success',
          );
        },
        revalidateOnFocus: true,
      },
    );
}

export type GoalAction = Pick<GoalActionImpl, keyof GoalActionImpl>;
