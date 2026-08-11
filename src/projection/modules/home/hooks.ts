'use client';

import type {
  HomeDailyBriefResponse,
  HomeRecentTopicsView,
  ProjectionRequestMarker,
} from '@lobechat/types';
import type { KeyedMutator } from 'swr';

import { useClientDataSWR } from '@/libs/swr';
import { homeKeys, projectionKeys } from '@/libs/swr/keys';
import { useCacheScope } from '@/libs/swr/useCacheScope';
import { briefService } from '@/services/brief';
import { homeService } from '@/services/home';
import { recentService } from '@/services/recent';
import { taskService } from '@/services/task';
import { topicService } from '@/services/topic';

import { nextProjectionObservedAt } from '../../core/ingest';
import { buildAccountProjectionScope } from '../../core/scope';
import { getProjectionStoreState, useProjectionStore } from '../../store';
import { useProjectionViewHydration } from '../../views/hook';
import {
  homeBriefsViewContract,
  homeDailyBriefViewContract,
  homeInboxTopicsViewContract,
  homeRecentTopicsViewContract,
  homeSidebarViewContract,
  homeTasksViewContract,
} from './contracts';
import {
  selectHomeBriefs,
  selectHomeInboxTopics,
  selectHomeRecentTopics,
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

const marker = (observedAt: number): ProjectionRequestMarker => ({ observedAt });

export const useHomeSidebarRequest = (
  isLogin: boolean | undefined,
): HomeDataRequest & { scope: string } => {
  useProjectionViewHydration(homeSidebarViewContract, {}, Boolean(isLogin));
  const scope = useCacheScope();
  const isInitialized = useProjectionStore((state) =>
    Boolean(selectHomeSidebar(state.scopes[scope])),
  );

  const request = useClientDataSWR<ProjectionRequestMarker>(
    isLogin ? projectionKeys.sidebar(scope) : null,
    async () => {
      const observedAt = nextProjectionObservedAt();
      const response = await homeService.getSidebarAgentList();
      getProjectionStoreState().ingestHomeSidebar(scope, response, observedAt);
      return marker(observedAt);
    },
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

  const request = useClientDataSWR<ProjectionRequestMarker>(
    isLogin ? projectionKeys.recentTopics(scope, limit, view) : null,
    async () => {
      const observedAt = nextProjectionObservedAt();
      // Workspace topics are shared, so "mine" must be narrowed server-side —
      // client-filtering the top N of a team-wide feed could starve out the
      // viewer's own topics entirely.
      const items = await recentService.getAll(limit, ['topic'], true, view !== 'team');
      getProjectionStoreState().ingestHomeRecentTopics(scope, items, limit, view, observedAt);
      return marker(observedAt);
    },
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

const HOME_INBOX_STATUSES = ['running', 'unread'];

export const useHomeInboxTopicsRequest = (
  isLogin: boolean | undefined,
): HomeDataRequest & { scope: string } => {
  useProjectionViewHydration(homeInboxTopicsViewContract, {}, Boolean(isLogin));
  const scope = useCacheScope();
  const isInitialized = useProjectionStore((state) =>
    Boolean(selectHomeInboxTopics(state.scopes[scope])),
  );

  const request = useClientDataSWR<ProjectionRequestMarker>(
    isLogin ? projectionKeys.inboxTopics(scope) : null,
    async () => {
      const observedAt = nextProjectionObservedAt();
      const items = await topicService.queryTopics({
        statuses: HOME_INBOX_STATUSES,
        withLastMessage: true,
      });
      getProjectionStoreState().ingestHomeInboxTopics(scope, items, observedAt);
      return marker(observedAt);
    },
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

  const request = useClientDataSWR<ProjectionRequestMarker>(
    isLogin ? projectionKeys.tasks(scope) : null,
    async () => {
      const observedAt = nextProjectionObservedAt();
      const result = await taskService.list({});
      getProjectionStoreState().ingestHomeTasks(scope, result.data, result.total, observedAt);
      return marker(observedAt);
    },
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

export const useHomeBriefsRequest = (isLogin: boolean | undefined): HomeDataRequest => {
  useProjectionViewHydration(homeBriefsViewContract, {}, Boolean(isLogin));
  const scope = useCacheScope();
  const isInitialized = useProjectionStore((state) =>
    Boolean(selectHomeBriefs(state.scopes[scope])),
  );

  const request = useClientDataSWR<ProjectionRequestMarker>(
    isLogin ? projectionKeys.briefs(scope) : null,
    async () => {
      const observedAt = nextProjectionObservedAt();
      const result = await briefService.listUnresolved();
      getProjectionStoreState().ingestHomeBriefs(scope, result.data, observedAt);
      return marker(observedAt);
    },
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
  const snapshot = useProjectionStore(
    (state) => state.scopes[accountScope]?.snapshots['home.dailyBrief'],
  );
  const data = snapshot?.key === 'home.dailyBrief' ? snapshot.data : undefined;
  const isInitialized = snapshot?.key === 'home.dailyBrief';

  const request = useClientDataSWR<ProjectionRequestMarker>(
    isLogin && userId ? homeKeys.dailyBrief(userId) : null,
    async () => {
      const observedAt = nextProjectionObservedAt();
      const response = await homeService.getDailyBrief();
      getProjectionStoreState().ingestHomeDailyBrief(accountScope, response, observedAt);
      return marker(observedAt);
    },
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
