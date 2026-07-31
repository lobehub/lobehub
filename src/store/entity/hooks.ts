'use client';

import type {
  HomeDailyBriefResponse,
  HomeDataRequestMarker,
  HomeRecentTopicsView,
} from '@lobechat/types';
import type { KeyedMutator } from 'swr';

import { buildAccountEntityScope } from '@/libs/entityData';
import { useClientDataSWR } from '@/libs/swr';
import { entityDataKeys, homeKeys } from '@/libs/swr/keys';
import { useCacheScope } from '@/libs/swr/useCacheScope';
import { briefService } from '@/services/brief';
import { homeService } from '@/services/home';
import { recentService } from '@/services/recent';
import { taskService } from '@/services/task';
import { topicService } from '@/services/topic';

import {
  selectHomeBriefs,
  selectHomeInboxTopics,
  selectHomeRecentTopics,
  selectHomeSidebar,
  selectHomeTasks,
} from './selectors';
import { getEntityStoreState, useEntityStore } from './store';

export interface HomeEntityRequest {
  error: unknown;
  isInitialized: boolean;
  isLoading: boolean;
  isValidating: boolean;
  mutate: KeyedMutator<HomeDataRequestMarker>;
}

export interface HomeSnapshotQuery<T> extends HomeEntityRequest {
  data: T | undefined;
}

const marker = (observedAt: number): HomeDataRequestMarker => ({ observedAt });

export const useHomeSidebarRequest = (
  isLogin: boolean | undefined,
): HomeEntityRequest & { scope: string } => {
  const scope = useCacheScope();
  const isInitialized = useEntityStore((state) => Boolean(selectHomeSidebar(state.scopes[scope])));

  const request = useClientDataSWR<HomeDataRequestMarker>(
    isLogin ? entityDataKeys.sidebar(scope) : null,
    async () => {
      const observedAt = Date.now();
      const response = await homeService.getSidebarAgentList();
      getEntityStoreState().ingestHomeSidebar(scope, response, observedAt);
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
): HomeEntityRequest => {
  const scope = useCacheScope();
  const isInitialized = useEntityStore((state) =>
    Boolean(selectHomeRecentTopics(state.scopes[scope], limit, view)),
  );

  const request = useClientDataSWR<HomeDataRequestMarker>(
    isLogin ? entityDataKeys.recentTopics(scope, limit, view) : null,
    async () => {
      const observedAt = Date.now();
      // Workspace topics are shared, so "mine" must be narrowed server-side —
      // client-filtering the top N of a team-wide feed could starve out the
      // viewer's own topics entirely.
      const items = await recentService.getAll(limit, ['topic'], true, view !== 'team');
      getEntityStoreState().ingestHomeRecentTopics(scope, items, limit, view, observedAt);
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
): HomeEntityRequest & { scope: string } => {
  const scope = useCacheScope();
  const isInitialized = useEntityStore((state) =>
    Boolean(selectHomeInboxTopics(state.scopes[scope])),
  );

  const request = useClientDataSWR<HomeDataRequestMarker>(
    isLogin ? entityDataKeys.inboxTopics(scope) : null,
    async () => {
      const observedAt = Date.now();
      const items = await topicService.queryTopics({
        statuses: HOME_INBOX_STATUSES,
        withLastMessage: true,
      });
      getEntityStoreState().ingestHomeInboxTopics(scope, items, observedAt);
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

export const useHomeTasksRequest = (isLogin: boolean | undefined): HomeEntityRequest => {
  const scope = useCacheScope();
  const isInitialized = useEntityStore((state) => Boolean(selectHomeTasks(state.scopes[scope])));

  const request = useClientDataSWR<HomeDataRequestMarker>(
    isLogin ? entityDataKeys.tasks(scope) : null,
    async () => {
      const observedAt = Date.now();
      const result = await taskService.list({});
      getEntityStoreState().ingestHomeTasks(scope, result.data, result.total, observedAt);
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

export const useHomeBriefsRequest = (isLogin: boolean | undefined): HomeEntityRequest => {
  const scope = useCacheScope();
  const isInitialized = useEntityStore((state) => Boolean(selectHomeBriefs(state.scopes[scope])));

  const request = useClientDataSWR<HomeDataRequestMarker>(
    isLogin ? entityDataKeys.briefs(scope) : null,
    async () => {
      const observedAt = Date.now();
      const result = await briefService.listUnresolved();
      getEntityStoreState().ingestHomeBriefs(scope, result.data, observedAt);
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
  const accountScope = userId ? buildAccountEntityScope(userId) : activeScope;
  const snapshot = useEntityStore(
    (state) => state.scopes[accountScope]?.snapshots['home.dailyBrief'],
  );
  const data = snapshot?.key === 'home.dailyBrief' ? snapshot.data : undefined;
  const isInitialized = snapshot?.key === 'home.dailyBrief';

  const request = useClientDataSWR<HomeDataRequestMarker>(
    isLogin && userId ? homeKeys.dailyBrief(userId) : null,
    async () => {
      const observedAt = Date.now();
      const response = await homeService.getDailyBrief();
      getEntityStoreState().ingestHomeDailyBrief(accountScope, response, observedAt);
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
