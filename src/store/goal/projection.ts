import type { GoalGraphSnapshot } from '@lobechat/types';

import { defineReplica, type ReplicaEntityAdapter } from '@/libs/replica';
import type { GoalListItem, goalService } from '@/services/goal';
import type { MetricSeriesWithPoints } from '@/services/metric';

import type { GoalListFilter } from './initialState';

type GoalListResponse = Awaited<ReturnType<typeof goalService.list>>;

/**
 * The list read's value: the page of goals plus the server's own total. The
 * total is the whole set, not the page — the header counts a scope whose goal
 * history is longer than one `limit` correctly, and the project dashboard
 * reports real progress rather than the slice it happens to hold.
 */
export interface GoalListValue {
  goals: GoalListItem[];
  total: number;
}

/**
 * Which list a goals page is showing. `all` is the scope's own entry — the
 * page-level window the project dashboard and the route meta read — while each
 * narrow tab keeps its own entry: the read only loads the newest page, so a
 * client-side filter would let a busy scope's older matching goal fall past the
 * page and the tab would report itself empty while the goal exists.
 */
export interface GoalListParams {
  agentId?: string;
  filter: GoalListFilter;
  projectId?: string;
}

/** The home rail's cross-agent roll-up, scoped like the other home feeds. */
export interface HomeGoalListParams {
  /** Cache scope (`userId:workspaceId`), so a workspace you left cannot answer here. */
  scope: string;
}

/**
 * Scope id of a goals page: an agent's page, or a project's. Also the entry key
 * of that scope's `all` list — the key `goalListByAgentId` has always used.
 */
export const goalListScopeId = ({
  agentId,
  projectId,
}: Pick<GoalListParams, 'agentId' | 'projectId'>): string =>
  projectId ? `project:${projectId}` : agentId!;

/** Rebuild the list params of one scope id (the inverse of `goalListScopeId`). */
export const goalListScopeParams = (scopeId: string, filter: GoalListFilter): GoalListParams =>
  scopeId.startsWith('project:')
    ? { filter, projectId: scopeId.slice('project:'.length) }
    : { agentId: scopeId, filter };

/**
 * Entry key of one tab's list. `all` keys the scope itself; a narrow tab keys a
 * sibling entry so switching tabs never resets the page-level window.
 */
export const goalListKey = (params: GoalListParams): string => {
  const scopeId = goalListScopeId(params);
  return params.filter === 'all' ? scopeId : `${scopeId}:goals-page:${params.filter}`;
};

/** Every tab of one scope, for a refresh that has to cover them all. */
export const GOAL_LIST_FILTERS: GoalListFilter[] = ['all', 'review', 'running', 'achieved'];

/** One scope's goal list, one entry per tab (`goalListByAgentId`). */
export const goalListResource = defineReplica<GoalListParams, GoalListValue, GoalListResponse>({
  key: goalListKey,
  name: 'goalList',
  storage: 'indexedDB',
  version: 1,
});

/** The home rail's cross-agent goal roll-up, one entry per cache scope. */
export const homeGoalListResource = defineReplica<
  HomeGoalListParams,
  GoalListValue,
  GoalListResponse
>({
  key: ({ scope }) => scope,
  name: 'homeGoalList',
  storage: 'indexedDB',
  version: 1,
});

/**
 * The Goal Graph snapshot behind the process-control surface, keyed by the
 * `goals` row id — the id every `goal.*` procedure takes (not the carrier
 * task's identifier).
 */
export const goalGraphResource = defineReplica<string, GoalGraphSnapshot>({
  key: (goalId) => goalId,
  name: 'goalGraph',
  storage: 'indexedDB',
  version: 1,
});

/**
 * North-star series of a goal (subjectType 'goal'), points included, keyed by
 * goal id like the graph snapshot — the strip and the graph describe the same
 * row and refresh together.
 */
export const goalMetricSeriesResource = defineReplica<string, MetricSeriesWithPoints[]>({
  key: (goalId) => goalId,
  name: 'goalMetricSeries',
  storage: 'indexedDB',
  version: 1,
});

/**
 * Goals are addressed by `goal.id` across the goal store, and a list row
 * carries the row plus its graph roll-up. Deleting one drops the row and the
 * total it was counted in, in every list that holds it — loaded or only
 * persisted, since the replica patches both.
 */
export const goalListEntity: ReplicaEntityAdapter<GoalListValue, GoalListItem> = {
  has: (data, id) => data.goals.some((item) => item.goal.id === id),
  map: (data, id, fn) => {
    const index = data.goals.findIndex((item) => item.goal.id === id);
    if (index === -1) return data;
    const current = data.goals[index];
    const next = fn(current);
    if (next === current) return data;
    if (next === undefined)
      return {
        goals: data.goals.filter((_, i) => i !== index),
        total: Math.max(0, data.total - 1),
      };
    const goals = [...data.goals];
    goals[index] = next;
    return { ...data, goals };
  },
};
