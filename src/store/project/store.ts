import type { SWRResponse } from 'swr';
import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';

import {
  getActiveWorkspaceId,
  useActiveWorkspaceId,
} from '@/business/client/hooks/useActiveWorkspaceId';
import { mutate, useClientDataSWR } from '@/libs/swr';
import { isProjectDetailKey, isProjectListKey, projectKeys } from '@/libs/swr/keys';
import { getCacheScope } from '@/libs/swr/useCacheScope';
import { projectService } from '@/services/project';
import { createDevtools } from '@/store/middleware/createDevtools';
import { expose } from '@/store/middleware/expose';

import {
  PROJECT_LIST_QUERY,
  projectDetailProjection,
  projectDetailWriteQueue,
  projectListProjection,
  projectListWriteQueue,
} from './projection';
import type { ProjectDispatchAction, ProjectEffect } from './reducer';
import { projectReducer } from './reducer';

type ProjectListResponse = Awaited<ReturnType<typeof projectService.listAll>>;
type ProjectDetailResponse = Awaited<ReturnType<typeof projectService.detail>>;
export type ProjectListItem = ProjectListResponse['data'][number];
export type ProjectDetail = ProjectDetailResponse['data'];

const currentScope = () => getCacheScope();

export interface ProjectStoreState {
  projectDetails: Record<string, Record<string, ProjectDetail>>;
  projectLists: Record<string, ProjectListItem[]>;
  projectOptimisticPatches: Record<string, Record<string, Partial<ProjectListItem>>>;
}

interface ProjectStore extends ProjectStoreState {
  createProject: (input: {
    identifier: string;
    name: string;
    slug?: string;
  }) => Promise<ProjectListItem>;
  deleteProject: (id: string) => Promise<void>;
  internal_dispatchProject: (action: ProjectDispatchAction) => void;
  refreshProjectList: () => Promise<void>;
  updateProject: (id: string, input: { name: string }) => Promise<ProjectListItem>;
  useFetchProjectDetail: (id?: string) => SWRResponse<ProjectDetailResponse>;
  useFetchProjectList: (enabled?: boolean) => SWRResponse<ProjectListResponse>;
}

const devtools = createDevtools('project');

export const useProjectStore = createWithEqualityFn<ProjectStore>()(
  devtools((set, get) => {
    const executeEffects = (effects: ProjectEffect[]) => {
      for (const effect of effects) {
        const key = { queryKey: effect.projection.queryKey, scope: effect.projection.scope };
        if (effect.type === 'invalidate') {
          void mutate((key) =>
            effect.projection.kind === 'list'
              ? isProjectListKey(key, effect.projection.scope)
              : isProjectDetailKey(key, effect.projection.scope, effect.projection.queryKey),
          );
        } else if (effect.projection.kind === 'list') {
          if (effect.type === 'remove') projectListWriteQueue.remove(key);
          else if ('value' in effect)
            projectListWriteQueue.set(key, {
              data: effect.value as ProjectListItem[],
              updatedAt: Date.now(),
            });
        } else if (effect.type === 'remove') projectDetailWriteQueue.remove(key);
        else if ('value' in effect)
          projectDetailWriteQueue.set(key, {
            data: effect.value as ProjectDetail,
            updatedAt: Date.now(),
          });
      }
    };
    const dispatch = (action: ProjectDispatchAction) => {
      const transition = projectReducer(get(), action);
      set(transition.state, false, `project/${action.type}`);
      executeEffects(transition.effects);
    };
    const refreshList = async (scope: string) => mutate((key) => isProjectListKey(key, scope));

    return {
      createProject: async (input) => {
        const scope = currentScope();
        const response = await projectService.create(input, getActiveWorkspaceId());
        dispatch({ project: response.data, scope, type: 'commitCreate' });
        void refreshList(scope);
        return response.data;
      },
      deleteProject: async (id) => {
        const scope = currentScope();
        await projectService.delete(id);
        dispatch({ id, scope, type: 'commitDelete' });
        void refreshList(scope);
      },
      internal_dispatchProject: dispatch,
      projectDetails: {},
      projectLists: {},
      projectOptimisticPatches: {},
      refreshProjectList: async () => {
        const scope = currentScope();
        await refreshList(scope);
      },
      updateProject: async (id, input) => {
        const scope = currentScope();
        dispatch({ id, patch: input, scope, type: 'optimisticUpdate' });
        try {
          const response = await projectService.update(id, input);
          dispatch({ id, project: response.data, scope, type: 'commitUpdate' });
          void refreshList(scope);
          return response.data;
        } catch (error) {
          dispatch({ id, scope, type: 'rollbackUpdate' });
          throw error;
        }
      },
      useFetchProjectDetail: (id) => {
        useActiveWorkspaceId();
        const scope = currentScope();
        useClientDataSWR(id ? projectKeys.detailHydration(scope, id) : null, async () => {
          const cached = await projectDetailProjection.get({ queryKey: id!, scope });
          if (cached && currentScope() === scope)
            dispatch({ data: cached.data, id: id!, scope, type: 'hydrateDetail' });
          return Date.now();
        });
        return useClientDataSWR(
          id ? projectKeys.detail(scope, id) : null,
          () => projectService.detail(id!),
          {
            onSuccess: (response: ProjectDetailResponse) => {
              if (currentScope() === scope)
                dispatch({ data: response.data, id: id!, scope, type: 'replaceDetail' });
            },
          },
        );
      },
      useFetchProjectList: (enabled = true) => {
        useActiveWorkspaceId();
        const scope = currentScope();
        useClientDataSWR(enabled ? projectKeys.listHydration(scope) : null, async () => {
          const cached = await projectListProjection.get({ queryKey: PROJECT_LIST_QUERY, scope });
          if (cached && currentScope() === scope)
            dispatch({ data: cached.data, scope, type: 'hydrateList' });
          return Date.now();
        });
        return useClientDataSWR(
          enabled ? projectKeys.list(scope) : null,
          () => projectService.listAll(),
          {
            onSuccess: (response: ProjectListResponse) => {
              if (currentScope() === scope)
                dispatch({ data: response.data, scope, type: 'replaceList' });
            },
          },
        );
      },
    };
  }),
  shallow,
);

expose('project', useProjectStore);

export const useCurrentProjectList = () => {
  useActiveWorkspaceId();
  const scope = currentScope();
  return useProjectStore((state) => {
    const patches = state.projectOptimisticPatches[scope];
    const list = state.projectLists[scope] ?? [];
    if (!patches || Object.keys(patches).length === 0) return list;
    return list.map((project) =>
      patches[project.id] ? { ...project, ...patches[project.id] } : project,
    );
  });
};

export const useCurrentProjectDetail = (id?: string) => {
  useActiveWorkspaceId();
  const scope = currentScope();
  return useProjectStore((state) => {
    if (!id) return undefined;
    const detail = state.projectDetails[scope]?.[id];
    const patch = state.projectOptimisticPatches[scope]?.[detail?.project.id ?? id];
    return detail && patch ? { ...detail, project: { ...detail.project, ...patch } } : detail;
  });
};
