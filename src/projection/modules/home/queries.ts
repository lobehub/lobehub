import { TASK_STATUSES } from '@lobechat/builtin-tool-task';
import type { HomeRecentTopicsView, TaskStatus } from '@lobechat/types';

import { briefService } from '@/services/brief';
import { homeService } from '@/services/home';
import { recentService } from '@/services/recent';
import { taskService } from '@/services/task';
import { topicService } from '@/services/topic';

import { defineProjectionQuery } from '../../query/runtime';
import { getProjectionStoreState } from '../../store';

type EmptyQueryParams = Record<string, never>;

export const homeSidebarProjectionQuery = defineProjectionQuery<
  EmptyQueryParams,
  Awaited<ReturnType<typeof homeService.getSidebarAgentList>>
>({
  project: (response, { observedAt, scope }) => {
    getProjectionStoreState().ingestHomeSidebar(scope, response, observedAt);
  },
  query: () => homeService.getSidebarAgentList(),
});

export interface HomeRecentTopicsQueryParams {
  limit: number;
  view: HomeRecentTopicsView;
}

export const homeRecentTopicsProjectionQuery = defineProjectionQuery<
  HomeRecentTopicsQueryParams,
  Awaited<ReturnType<typeof recentService.getAll>>
>({
  project: (items, { observedAt, params, scope }) => {
    getProjectionStoreState().ingestHomeRecentTopics(
      scope,
      items,
      params.limit,
      params.view,
      observedAt,
    );
  },
  query: ({ limit, view }) => recentService.getAll(limit, ['topic'], true, view !== 'team'),
});

const HOME_INBOX_STATUSES = ['running', 'unread'];

export const homeInboxTopicsProjectionQuery = defineProjectionQuery<
  EmptyQueryParams,
  Awaited<ReturnType<typeof topicService.queryTopics>>
>({
  project: (items, { observedAt, scope }) => {
    getProjectionStoreState().ingestHomeInboxTopics(scope, items, observedAt);
  },
  query: () => topicService.queryTopics({ statuses: HOME_INBOX_STATUSES, withLastMessage: true }),
});

type TaskListResponse = Awaited<ReturnType<typeof taskService.list>>;

export const HOME_RECENT_TASK_STATUSES: TaskStatus[] = TASK_STATUSES.filter(
  (status) => status !== 'completed',
);

export const homeTasksProjectionQuery = defineProjectionQuery<EmptyQueryParams, TaskListResponse>({
  project: (result, { observedAt, scope }) => {
    getProjectionStoreState().ingestHomeTasks(scope, result.data, result.total, observedAt);
  },
  query: () =>
    taskService.list({
      automated: false,
      orderBy: 'updatedAt',
      statuses: HOME_RECENT_TASK_STATUSES,
    }),
});

export const homeScheduledTasksProjectionQuery = defineProjectionQuery<
  EmptyQueryParams,
  TaskListResponse
>({
  project: (result, { observedAt, scope }) => {
    getProjectionStoreState().ingestHomeScheduledTasks(
      scope,
      result.data,
      result.total,
      observedAt,
    );
  },
  query: () => taskService.list({ automated: true, orderBy: 'updatedAt' }),
});

export const homeBriefsProjectionQuery = defineProjectionQuery<
  EmptyQueryParams,
  Awaited<ReturnType<typeof briefService.listUnresolved>>
>({
  project: (result, { observedAt, scope }) => {
    getProjectionStoreState().ingestHomeBriefs(scope, result.data, observedAt);
  },
  query: () => briefService.listUnresolved(),
});

export const homeDailyBriefProjectionQuery = defineProjectionQuery<
  EmptyQueryParams,
  Awaited<ReturnType<typeof homeService.getDailyBrief>>
>({
  project: (response, { observedAt, scope }) => {
    getProjectionStoreState().ingestHomeDailyBrief(scope, response, observedAt);
  },
  query: () => homeService.getDailyBrief(),
});
