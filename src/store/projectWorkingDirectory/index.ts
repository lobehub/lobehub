import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { getCacheScope, useCacheScope } from '@/libs/swr/useCacheScope';
import type { BindProjectDirectoryInput } from '@/services/projectWorkingDirectory';
import { projectWorkingDirectoryService } from '@/services/projectWorkingDirectory';

export type ProjectDirectory = Awaited<
  ReturnType<typeof projectWorkingDirectoryService.list>
>['data'][number];
export type ProjectTopic = Awaited<
  ReturnType<typeof projectWorkingDirectoryService.listProjectTopics>
>['data'][number];

/** Poll cadence for the project topic list while a conversation is in flight. */
export const PROJECT_TOPICS_POLL_INTERVAL = 5000;

/**
 * The statuses the server can still move on its own. Every other status —
 * including `active`/`unread` — stays put until the user acts, so a project
 * whose conversations are all settled has nothing left to refresh.
 */
const IN_FLIGHT_TOPIC_STATUSES = new Set(['running', 'waitingForHuman']);

/** Whether a project still has a conversation the server may still be updating. */
export const hasInFlightProjectTopic = (topics?: ProjectTopic[]) =>
  !!topics?.some((topic) => !!topic.status && IN_FLIGHT_TOPIC_STATUSES.has(topic.status));
const directoryKey = (scope: string, projectId?: string) =>
  ['project/directories', scope, projectId ?? 'all'] as const;
const topicsKey = (scope: string, id: string) => ['project/directoryTopics', scope, id] as const;

const environmentKey = (scope: string, projectId?: string) =>
  ['project/environments', scope, projectId ?? 'all'] as const;
const projectTopicsKey = (scope: string, projectId: string) =>
  ['project/topics', scope, projectId] as const;
const refreshProjectTopics = () =>
  mutate((key) => Array.isArray(key) && key[0] === 'project/topics' && key[1] === getCacheScope());
const createActions = () => ({
  useFetchProjectTopics: (projectId?: string) => {
    const scope = useCacheScope();
    return useClientDataSWR(
      projectId ? projectTopicsKey(scope, projectId) : null,
      () => projectWorkingDirectoryService.listProjectTopics(projectId!),
      {
        // Poll only while a conversation is still in flight (same shape as the
        // group-task poll): an idle project has no server-side change to pick
        // up, and polling it every 5s would re-read the whole project history
        // forever for nothing.
        refreshInterval: (data) =>
          hasInFlightProjectTopic(data?.data) ? PROJECT_TOPICS_POLL_INTERVAL : 0,
      },
    );
  },
  createProjectTopic: async (
    input: Parameters<typeof projectWorkingDirectoryService.createProjectTopic>[0],
  ) => {
    const result = await projectWorkingDirectoryService.createProjectTopic(input);
    await refreshProjectTopics();
    return result.data;
  },
  associateTopic: async (
    input: Parameters<typeof projectWorkingDirectoryService.associateTopic>[0],
  ) => {
    const result = await projectWorkingDirectoryService.associateTopic(input);
    await refreshProjectTopics();
    return result.data;
  },
  useFetchEnvironments: (projectId?: string) => {
    const scope = useCacheScope();
    return useClientDataSWR(environmentKey(scope, projectId), () =>
      projectWorkingDirectoryService.listEnvironments(projectId),
    );
  },
  saveEnvironment: async (
    input: Parameters<typeof projectWorkingDirectoryService.saveEnvironment>[0],
  ) => {
    const result = await projectWorkingDirectoryService.saveEnvironment(input);
    await mutate(
      (key) =>
        Array.isArray(key) &&
        ['project/environments', 'project/directories'].includes(key[0]) &&
        key[1] === getCacheScope(),
    );
    return result.data;
  },
  attachEnvironment: async (projectId: string, environmentId: string) => {
    await projectWorkingDirectoryService.attachEnvironment(projectId, environmentId);
    await mutate(environmentKey(getCacheScope(), projectId));
  },
  bind: async (input: BindProjectDirectoryInput) => {
    const result = await projectWorkingDirectoryService.bind(input);
    await Promise.all([
      refreshProjectTopics(),
      mutate(directoryKey(getCacheScope())),
      mutate(directoryKey(getCacheScope(), input.projectId)),
      mutate(
        (key) =>
          Array.isArray(key) &&
          key[0] === 'project/environmentTopics' &&
          key[1] === getCacheScope(),
      ),
      mutate(environmentKey(getCacheScope())),
      mutate(environmentKey(getCacheScope(), input.projectId)),
    ]);
    return result.data;
  },
  useFetchEnvironmentTopics: (directoryIds: string[]) => {
    const scope = useCacheScope();
    const ids = [...directoryIds].sort();
    return useClientDataSWR(['project/environmentTopics', scope, ...ids], () =>
      projectWorkingDirectoryService.listEnvironmentTopics(ids),
    );
  },
  startTopic: async (id: string, agentId: string, title: string) => {
    const result = await projectWorkingDirectoryService.startTopic({ agentId, id, title });
    await Promise.all([
      refreshProjectTopics(),
      mutate(topicsKey(getCacheScope(), id)),
      mutate(
        (key) =>
          Array.isArray(key) &&
          key[0] === 'project/environmentTopics' &&
          key[1] === getCacheScope(),
      ),
    ]);
    return result.data;
  },
  useFetchDirectories: (projectId?: string, enabled = true) => {
    const scope = useCacheScope();
    return useClientDataSWR(enabled ? directoryKey(scope, projectId) : null, () =>
      projectWorkingDirectoryService.list(projectId),
    );
  },
  useFetchDirectoryTopics: (id?: string) => {
    const scope = useCacheScope();
    return useClientDataSWR(id ? topicsKey(scope, id) : null, () =>
      projectWorkingDirectoryService.listTopics(id!),
    );
  },
});
export const useProjectDirectoryStore = createWithEqualityFn<ReturnType<typeof createActions>>()(
  createActions,
  shallow,
);
