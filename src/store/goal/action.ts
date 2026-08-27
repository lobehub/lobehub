import { type GoalStatus, goalStatuses } from '@lobechat/const/goal';
import type { GoalTickResult } from '@lobechat/types';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { goalKeys, taskKeys } from '@/libs/swr/keys';
import { goalService } from '@/services/goal';
import type { StoreSetter } from '@/store/types';

import type { GoalListFilter, GoalState, GoalViewMode } from './initialState';

const GOAL_STATUSES: GoalStatus[] = [...goalStatuses];

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
// The home roll-up only renders goals that are still open: terminal states
// (achieved / canceled) stay on the server, `review` is included because a
// converged goal is still awaiting the user's sign-off.
const HOME_GOAL_STATUSES: GoalStatus[] = ['planning', 'running', 'verifying', 'review'];
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
    await goalService.delete(goalId);
    const current = this.#get().goalListByAgentId[agentId] ?? [];
    this.#set(
      ({ goalListByAgentId }) => ({
        goalListByAgentId: {
          ...goalListByAgentId,
          [agentId]: current.filter(({ goal }) => goal.id !== goalId),
        },
      }),
      false,
      'deleteGoal/success',
    );
    await this.refreshGoals(agentId);
  };

  /**
   * Resolve a pending decision gate. `goalId` is the `goals` row id.
   *
   * Resolving a gate does not advance the graph — the coordinator only moves on
   * the next tick — so the caller decides whether to follow up with `tickGoal`.
   */
  decideGoal = async (
    goalId: string,
    params: { decisionId: string; optionId: string; resolution?: string },
  ): Promise<void> => {
    await goalService.decide({ id: goalId, ...params });
    await this.refreshGoalGraph(goalId);
  };

  pauseGoal = async (goalId: string): Promise<void> => {
    await goalService.pause(goalId);
    await this.refreshGoalGraph(goalId);
  };

  refreshGoalGraph = async (goalId: string): Promise<void> => {
    await mutate(goalKeys.graph(goalId));
  };

  resumeGoal = async (goalId: string): Promise<void> => {
    await goalService.resume(goalId);
    await this.refreshGoalGraph(goalId);
  };

  setGoalBudget = async (
    goalId: string,
    budget: { maxRounds?: number | null; maxTotalCost?: number | null },
  ): Promise<void> => {
    await goalService.setBudget({ id: goalId, ...budget });
    await this.refreshGoalGraph(goalId);
  };

  /**
   * One coordinator step. Graph goals have no server-side driver, so this is
   * the only thing that moves them from the app.
   */
  tickGoal = async (goalId: string): Promise<GoalTickResult> => {
    const result = await goalService.tick(goalId);
    await this.refreshGoalGraph(goalId);
    return result;
  };

  /** The Goal Graph snapshot behind the process-control surface. */
  useFetchGoalGraph = (goalId?: string | null) =>
    useClientDataSWR(goalId ? goalKeys.graph(goalId) : null, () => goalService.getGraph(goalId!), {
      onSuccess: (graph) => {
        this.#set(
          ({ goalGraphById }) => ({ goalGraphById: { ...goalGraphById, [goalId!]: graph } }),
          false,
          'useFetchGoalGraph/success',
        );
      },
      revalidateOnFocus: true,
    });

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
      () =>
        goalService.list({
          agentId,
          limit: 100,
          projectId,
          statuses: GOAL_STATUSES,
        }),
      {
        onSuccess: ({ goals }) => {
          this.#set(
            ({ goalListByAgentId, goalListInitializedAgentIds }) => ({
              goalListByAgentId: {
                ...goalListByAgentId,
                [scopeId!]: goals,
              },
              goalListInitializedAgentIds: goalListInitializedAgentIds.includes(scopeId!)
                ? goalListInitializedAgentIds
                : [...goalListInitializedAgentIds, scopeId!],
            }),
            false,
            'useFetchGoals/success',
          );
        },
        revalidateOnFocus: true,
      },
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
        goalService.list({
          limit: HOME_GOAL_FETCH_LIMIT,
          statuses: HOME_GOAL_STATUSES,
        }),
      {
        onSuccess: ({ goals }) => {
          this.#set(
            ({ homeGoalsByScope, homeGoalsInitializedScopes }) => ({
              homeGoalsByScope: { ...homeGoalsByScope, [scope]: goals },
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
