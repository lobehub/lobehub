import { mutate, useClientDataSWR } from '@/libs/swr';
import { taskKeys } from '@/libs/swr/keys';
import { getCacheScope } from '@/libs/swr/useCacheScope';
import { getProjectionStoreState, nextProjectionObservedAt } from '@/projection';
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
 * The home roll-up only ever renders goals that are still open, so it asks for
 * the statuses one can be open in and leaves the terminal ones on the server.
 * `completed` is in because a completed goal is awaiting acceptance until the
 * user accepts it.
 *
 * The limit still bites in a workspace with more than this many such goals —
 * `groupList` takes the newest, and accepted goals stay `completed` — so the
 * tail of a very long history can crowd out an old still-running goal. Fixing
 * that for real needs an acceptance join on the server; this keeps the window
 * as wide as the query allows in the meantime.
 */
const HOME_GOAL_STATUSES = ['backlog', 'running', 'scheduled', 'completed'];
const HOME_GOAL_FETCH_LIMIT = 100;

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

  refreshHomeGoals = async (scope: string): Promise<void> => {
    await mutate(taskKeys.homeGoals(scope));
  };

  setGoalListFilter = (filter: GoalListFilter): void => {
    this.#set({ goalListFilter: filter, goalListVisibleLimit: 10 }, false, 'setGoalListFilter');
  };

  setGoalViewMode = (mode: GoalViewMode): void => {
    this.#set({ goalViewMode: mode }, false, 'setGoalViewMode');
  };

  useFetchGoals = (agentId?: string, projectId?: string) => {
    const scopeId = projectId ? `project:${projectId}` : agentId;

    return useClientDataSWR(
      scopeId ? taskKeys.sidebarGroups(`${scopeId}:goals-page`) : null,
      async () => {
        const scope = getCacheScope();
        const observedAt = nextProjectionObservedAt();
        const result = await taskService.groupList({
          assigneeAgentId: agentId,
          groups: [{ key: 'goals', limit: 100, statuses: GOAL_STATUSES }],
          hasGoal: true,
          parentTaskId: null,
          projectId,
        });
        getProjectionStoreState().commitTaskGroupList(
          scope,
          result.data,
          { agentKey: `${scopeId}:goals-page`, visibility: 'all' },
          observedAt,
        );
        return result;
      },
      { revalidateOnFocus: true },
    );
  };

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
          groups: [{ key: 'goals', limit: HOME_GOAL_FETCH_LIMIT, statuses: HOME_GOAL_STATUSES }],
          hasGoal: true,
          parentTaskId: null,
        }),
      {
        onSuccess: ({ data }) => {
          this.#set(
            ({ homeGoalsByScope, homeGoalsInitializedScopes }) => ({
              homeGoalsByScope: { ...homeGoalsByScope, [scope]: data[0]?.tasks ?? [] },
              homeGoalsInitializedScopes: homeGoalsInitializedScopes.includes(scope)
                ? homeGoalsInitializedScopes
                : [...homeGoalsInitializedScopes, scope],
            }),
            false,
            'useFetchHomeGoals/success',
          );
        },
        revalidateOnFocus: true,
      },
    );
}

export type GoalAction = Pick<GoalActionImpl, keyof GoalActionImpl>;
