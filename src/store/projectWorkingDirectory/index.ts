import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { getCacheScope, useCacheScope } from '@/libs/swr/useCacheScope';
import type { BindProjectDirectoryInput } from '@/services/projectWorkingDirectory';
import { projectWorkingDirectoryService } from '@/services/projectWorkingDirectory';

export type ProjectDirectory = Awaited<
  ReturnType<typeof projectWorkingDirectoryService.list>
>['data'][number];
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
      { refreshInterval: 5000 },
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
