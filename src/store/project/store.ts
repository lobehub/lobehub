import type { SWRResponse } from 'swr';
import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';

import {
  getActiveWorkspaceId,
  useActiveWorkspaceId,
} from '@/business/client/hooks/useActiveWorkspaceId';
import { mutate, useClientDataSWR } from '@/libs/swr';
import { projectService } from '@/services/project';
import { createDevtools } from '@/store/middleware/createDevtools';
import { expose } from '@/store/middleware/expose';

type ProjectListResponse = Awaited<ReturnType<typeof projectService.listAll>>;
type ProjectDetailResponse = Awaited<ReturnType<typeof projectService.detail>>;
export type ProjectListItem = ProjectListResponse['data'][number];
export type ProjectDetail = ProjectDetailResponse['data'];

const LIST_KEY = 'project/list';
const detailKey = (id: string) => ['project/detail', id] as const;
const PERSONAL_SCOPE = 'personal';
const projectScopeKey = (workspaceId: string | null) => workspaceId ?? PERSONAL_SCOPE;

interface ProjectStore {
  createProject: (input: {
    identifier: string;
    name: string;
    slug?: string;
  }) => Promise<ProjectListItem>;
  deleteProject: (id: string) => Promise<void>;
  projectDetails: Record<string, Record<string, ProjectDetail>>;
  projectLists: Record<string, ProjectListItem[]>;
  refreshProjectList: () => Promise<void>;
  updateProject: (id: string, input: { name: string }) => Promise<ProjectListItem>;
  useFetchProjectDetail: (id?: string) => SWRResponse<ProjectDetailResponse>;
  useFetchProjectList: (enabled?: boolean) => SWRResponse<ProjectListResponse>;
}

const devtools = createDevtools('project');

export const useProjectStore = createWithEqualityFn<ProjectStore>()(
  devtools((set, get) => ({
    createProject: async (input) => {
      const response = await projectService.create(input, getActiveWorkspaceId());
      await get().refreshProjectList();
      return response.data;
    },
    deleteProject: async (id) => {
      await projectService.delete(id);
      await get().refreshProjectList();
    },
    projectDetails: {},
    projectLists: {},
    refreshProjectList: async () => mutate(LIST_KEY),
    updateProject: async (id, input) => {
      const response = await projectService.update(id, input);
      const project = response.data;

      set(
        (state) => ({
          projectDetails: Object.fromEntries(
            Object.entries(state.projectDetails).map(([scope, details]) => [
              scope,
              Object.fromEntries(
                Object.entries(details).map(([reference, detail]) => [
                  reference,
                  detail.project.id === id ? { ...detail, project } : detail,
                ]),
              ),
            ]),
          ),
          projectLists: Object.fromEntries(
            Object.entries(state.projectLists).map(([scope, projects]) => [
              scope,
              projects.map((item) => (item.id === id ? project : item)),
            ]),
          ),
        }),
        false,
        'updateProject/success',
      );
      await get().refreshProjectList();
      return project;
    },
    useFetchProjectDetail: (id) => {
      const workspaceId = useActiveWorkspaceId();
      const scope = projectScopeKey(workspaceId);

      return useClientDataSWR(id ? detailKey(id) : null, () => projectService.detail(id!), {
        onSuccess: (response: ProjectDetailResponse) =>
          set(
            (state) => ({
              projectDetails: {
                ...state.projectDetails,
                [scope]: { ...state.projectDetails[scope], [id!]: response.data },
              },
            }),
            false,
            'useFetchProjectDetail/success',
          ),
      });
    },
    useFetchProjectList: (enabled = true) => {
      const workspaceId = useActiveWorkspaceId();
      const scope = projectScopeKey(workspaceId);

      return useClientDataSWR(enabled ? LIST_KEY : null, () => projectService.listAll(), {
        onSuccess: (response: ProjectListResponse) =>
          set(
            (state) => ({ projectLists: { ...state.projectLists, [scope]: response.data } }),
            false,
            'useFetchProjectList/success',
          ),
      });
    },
  })),
  shallow,
);

expose('project', useProjectStore);

export const useCurrentProjectList = () => {
  const scope = projectScopeKey(useActiveWorkspaceId());
  return useProjectStore((state) => state.projectLists[scope] ?? []);
};

export const useCurrentProjectDetail = (id?: string) => {
  const scope = projectScopeKey(useActiveWorkspaceId());
  return useProjectStore((state) => (id ? state.projectDetails[scope]?.[id] : undefined));
};
