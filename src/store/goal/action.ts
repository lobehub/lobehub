import { mutate } from '@/libs/swr';
import { taskKeys } from '@/libs/swr/keys';
import { getCacheScope } from '@/libs/swr/useCacheScope';
import { getProjectionStoreState, nextProjectionObservedAt } from '@/projection';
import { taskGroupListProjectionQuery } from '@/projection/modules/task/queries';
import { useProjectionRequest } from '@/projection/query/hook';
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

export type GoalStore = GoalState & GoalAction;
type Setter = StoreSetter<GoalStore>;

export class GoalActionImpl {
  readonly #set: Setter;

  constructor(set: Setter, get: () => GoalStore, _api?: unknown) {
    void _api;
    void get;
    this.#set = set;
  }

  deleteGoal = async (agentId: string, goalId: string): Promise<void> => {
    const scope = getCacheScope();
    const observedAt = nextProjectionObservedAt();
    await taskService.deleteGoal(goalId);
    getProjectionStoreState().deleteTaskProjection(scope, goalId, observedAt);
    await this.refreshGoals(agentId);
  };

  loadMoreGoals = (): void => {
    this.#set(
      ({ goalListVisibleLimit }) => ({ goalListVisibleLimit: goalListVisibleLimit + 10 }),
      false,
      'loadMoreGoals',
    );
  };

  refreshGoals = async (scopeId: string): Promise<void> => {
    await mutate(taskKeys.sidebarGroups(`${scopeId}:goals-page`));
  };

  setGoalListFilter = (filter: GoalListFilter): void => {
    this.#set({ goalListFilter: filter, goalListVisibleLimit: 10 }, false, 'setGoalListFilter');
  };

  setGoalViewMode = (mode: GoalViewMode): void => {
    this.#set({ goalViewMode: mode }, false, 'setGoalViewMode');
  };

  useFetchGoals = (agentId?: string, projectId?: string) => {
    const scopeId = projectId ? `project:${projectId}` : agentId;

    return useProjectionRequest(
      scopeId ? taskKeys.sidebarGroups(`${scopeId}:goals-page`) : null,
      taskGroupListProjectionQuery,
      {
        request: {
          assigneeAgentId: agentId,
          groups: [{ key: 'goals', limit: 100, statuses: GOAL_STATUSES }],
          hasGoal: true,
          parentTaskId: null,
          projectId,
        },
        signature: { agentKey: `${scopeId}:goals-page`, visibility: 'all' },
      },
      { revalidateOnFocus: true },
    );
  };
}

export type GoalAction = Pick<GoalActionImpl, keyof GoalActionImpl>;
