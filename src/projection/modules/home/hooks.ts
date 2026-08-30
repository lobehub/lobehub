'use client';

import type {
  HomeDailyBriefResponse,
  HomeRecentTopicsView,
  ProjectionRequestMarker,
} from '@lobechat/types';
import type { KeyedMutator } from 'swr';

import { homeKeys, projectionKeys, taskKeys } from '@/libs/swr/keys';
import { useCacheScope } from '@/libs/swr/useCacheScope';

import { buildAccountProjectionScope } from '../../core/scope';
import { useProjectionRequest } from '../../query/hook';
import { useProjectionStore } from '../../store';
import { useProjectionViewHydration } from '../../views/hook';
import { taskGroupListViewContract } from '../task/contracts';
import { taskGroupListProjectionQuery } from '../task/queries';
import { selectTaskGroupList } from '../task/selectors';
import {
  homeBriefsViewContract,
  homeDailyBriefViewContract,
  homeInboxTopicsViewContract,
  homeRecentTopicsViewContract,
  homeScheduledTasksViewContract,
  homeSidebarViewContract,
  homeTasksViewContract,
} from './contracts';
import {
  homeBriefsProjectionQuery,
  homeDailyBriefProjectionQuery,
  homeInboxTopicsProjectionQuery,
  homeRecentTopicsProjectionQuery,
  homeScheduledTasksProjectionQuery,
  homeSidebarProjectionQuery,
  homeTasksProjectionQuery,
} from './queries';
import {
  selectHomeBriefs,
  selectHomeDailyBrief,
  selectHomeInboxTopics,
  selectHomeRecentTopics,
  selectHomeScheduledTasks,
  selectHomeSidebar,
  selectHomeTasks,
} from './selectors';

export interface HomeDataRequest {
  error: unknown;
  isInitialized: boolean;
  isLoading: boolean;
  isValidating: boolean;
  mutate: KeyedMutator<ProjectionRequestMarker>;
}

export interface HomeSnapshotQuery<T> extends HomeDataRequest {
  data: T | undefined;
}

export const HOME_GOALS_AGENT_KEY = '__home_goals__';
export { HOME_RECENT_TASK_STATUSES } from './queries';
export const HOME_GOALS_SIGNATURE = {
  agentKey: HOME_GOALS_AGENT_KEY,
  visibility: 'all',
} as const;

const HOME_GOAL_STATUSES = ['backlog', 'running', 'scheduled', 'completed'];
const HOME_GOAL_FETCH_LIMIT = 100;

export const useHomeSidebarRequest = (
  isLogin: boolean | undefined,
): HomeDataRequest & { scope: string } => {
  useProjectionViewHydration(homeSidebarViewContract, {}, Boolean(isLogin));
  const scope = useCacheScope();
  const isInitialized = useProjectionStore((state) =>
    Boolean(selectHomeSidebar(state.scopes[scope])),
  );

  const request = useProjectionRequest(
    isLogin ? projectionKeys.sidebar(scope) : null,
    homeSidebarProjectionQuery,
    {},
    { revalidateOnFocus: false },
  );
  return {
    error: request.error,
    isInitialized,
    isLoading: request.isLoading && !isInitialized,
    isValidating: request.isValidating,
    mutate: request.mutate,
    scope,
  };
};

export const useHomeRecentTopicsRequest = (
  isLogin: boolean | undefined,
  limit: number,
  view: HomeRecentTopicsView = 'mine',
): HomeDataRequest => {
  useProjectionViewHydration(homeRecentTopicsViewContract, { limit, view }, Boolean(isLogin));
  const scope = useCacheScope();
  const isInitialized = useProjectionStore((state) =>
    Boolean(selectHomeRecentTopics(state.scopes[scope], limit, view)),
  );

  const request = useProjectionRequest(
    isLogin ? projectionKeys.recentTopics(scope, limit, view) : null,
    homeRecentTopicsProjectionQuery,
    { limit, view },
    { revalidateOnFocus: false },
  );
  return {
    error: request.error,
    isInitialized,
    isLoading: request.isLoading && !isInitialized,
    isValidating: request.isValidating,
    mutate: request.mutate,
  };
};

export const useHomeInboxTopicsRequest = (
  isLogin: boolean | undefined,
): HomeDataRequest & { scope: string } => {
  useProjectionViewHydration(homeInboxTopicsViewContract, {}, Boolean(isLogin));
  const scope = useCacheScope();
  const isInitialized = useProjectionStore((state) =>
    Boolean(selectHomeInboxTopics(state.scopes[scope])),
  );

  const request = useProjectionRequest(
    isLogin ? projectionKeys.inboxTopics(scope) : null,
    homeInboxTopicsProjectionQuery,
    {},
    { focusThrottleInterval: 1000 },
  );
  return {
    error: request.error,
    isInitialized,
    isLoading: request.isLoading && !isInitialized,
    isValidating: request.isValidating,
    mutate: request.mutate,
    scope,
  };
};

export const useHomeTasksRequest = (isLogin: boolean | undefined): HomeDataRequest => {
  useProjectionViewHydration(homeTasksViewContract, {}, Boolean(isLogin));
  const scope = useCacheScope();
  const isInitialized = useProjectionStore((state) =>
    Boolean(selectHomeTasks(state.scopes[scope])),
  );

  const request = useProjectionRequest(
    isLogin ? projectionKeys.tasks(scope) : null,
    homeTasksProjectionQuery,
    {},
    { revalidateOnFocus: false },
  );
  return {
    error: request.error,
    isInitialized,
    isLoading: request.isLoading && !isInitialized,
    isValidating: request.isValidating,
    mutate: request.mutate,
  };
};

export const useHomeScheduledTasksRequest = (isLogin: boolean | undefined): HomeDataRequest => {
  useProjectionViewHydration(homeScheduledTasksViewContract, {}, Boolean(isLogin));
  const scope = useCacheScope();
  const isInitialized = useProjectionStore((state) =>
    Boolean(selectHomeScheduledTasks(state.scopes[scope])),
  );

  const request = useProjectionRequest(
    isLogin ? projectionKeys.scheduledTasks(scope) : null,
    homeScheduledTasksProjectionQuery,
    {},
    { revalidateOnFocus: false },
  );
  return {
    error: request.error,
    isInitialized,
    isLoading: request.isLoading && !isInitialized,
    isValidating: request.isValidating,
    mutate: request.mutate,
  };
};

export const useHomeGoalsRequest = (enabled: boolean): HomeDataRequest => {
  useProjectionViewHydration(taskGroupListViewContract, HOME_GOALS_SIGNATURE, enabled);
  const scope = useCacheScope();
  const isInitialized = useProjectionStore((state) =>
    Boolean(selectTaskGroupList(state.scopes[scope], HOME_GOALS_SIGNATURE)),
  );

  const request = useProjectionRequest(
    enabled ? taskKeys.homeGoals(scope) : null,
    taskGroupListProjectionQuery,
    {
      request: {
        groups: [{ key: 'goals', limit: HOME_GOAL_FETCH_LIMIT, statuses: HOME_GOAL_STATUSES }],
        parentTaskId: null,
      },
      signature: HOME_GOALS_SIGNATURE,
    },
    { revalidateOnFocus: true },
  );
  return {
    error: request.error,
    isInitialized,
    isLoading: request.isLoading && !isInitialized,
    isValidating: request.isValidating,
    mutate: request.mutate,
  };
};

export const useHomeBriefsRequest = (isLogin: boolean | undefined): HomeDataRequest => {
  useProjectionViewHydration(homeBriefsViewContract, {}, Boolean(isLogin));
  const scope = useCacheScope();
  const isInitialized = useProjectionStore((state) =>
    Boolean(selectHomeBriefs(state.scopes[scope])),
  );

  const request = useProjectionRequest(
    isLogin ? projectionKeys.briefs(scope) : null,
    homeBriefsProjectionQuery,
    {},
    { revalidateOnFocus: false },
  );
  return {
    error: request.error,
    isInitialized,
    isLoading: request.isLoading && !isInitialized,
    isValidating: request.isValidating,
    mutate: request.mutate,
  };
};

export const useHomeDailyBriefData = (
  isLogin: boolean | undefined,
  userId: string | undefined,
): HomeSnapshotQuery<HomeDailyBriefResponse> => {
  const activeScope = useCacheScope();
  const accountScope = userId ? buildAccountProjectionScope(userId) : activeScope;
  useProjectionViewHydration(
    homeDailyBriefViewContract,
    {},
    Boolean(isLogin && userId),
    accountScope,
  );
  const data = useProjectionStore((state) => selectHomeDailyBrief(state.scopes[accountScope]));
  const isInitialized = data !== undefined;

  const request = useProjectionRequest(
    isLogin && userId ? homeKeys.dailyBrief(userId) : null,
    homeDailyBriefProjectionQuery,
    {},
    { scope: accountScope },
  );
  return {
    data,
    error: request.error,
    isInitialized,
    isLoading: request.isLoading && !isInitialized,
    isValidating: request.isValidating,
    mutate: request.mutate,
  };
};
