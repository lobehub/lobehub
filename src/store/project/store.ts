import type { SWRResponse } from 'swr';
import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { projectService } from '@/services/project';
import { createDevtools } from '@/store/middleware/createDevtools';
import { expose } from '@/store/middleware/expose';

type ProjectListResponse = Awaited<ReturnType<typeof projectService.list>>;
type ProjectDetailResponse = Awaited<ReturnType<typeof projectService.detail>>;
export type ProjectListItem = ProjectListResponse['data'][number];
export type ProjectDetail = ProjectDetailResponse['data'];

const LIST_KEY = 'project/list';
const detailKey = (id: string) => ['project/detail', id] as const;

interface ProjectStore {
  createProject: (input: { identifier: string; name: string }) => Promise<ProjectListItem>;
  projectDetails: Record<string, ProjectDetail>;
  projectList: ProjectListItem[];
  projectListInit: boolean;
  refreshProjectList: () => Promise<void>;
  useFetchProjectDetail: (id?: string) => SWRResponse<ProjectDetailResponse>;
  useFetchProjectList: (enabled?: boolean) => SWRResponse<ProjectListResponse>;
}

const devtools = createDevtools('project');

export const useProjectStore = createWithEqualityFn<ProjectStore>()(
  devtools((set, get) => ({
    createProject: async (input) => {
      const response = await projectService.create(input);
      await get().refreshProjectList();
      return response.data;
    },
    projectDetails: {},
    projectList: [],
    projectListInit: false,
    refreshProjectList: async () => mutate(LIST_KEY),
    useFetchProjectDetail: (id) =>
      useClientDataSWR(id ? detailKey(id) : null, () => projectService.detail(id!), {
        onSuccess: (response: ProjectDetailResponse) =>
          set(
            (state) => ({
              projectDetails: { ...state.projectDetails, [id!]: response.data },
            }),
            false,
            'useFetchProjectDetail/success',
          ),
      }),
    useFetchProjectList: (enabled = true) =>
      useClientDataSWR(enabled ? LIST_KEY : null, () => projectService.list(), {
        onSuccess: (response: ProjectListResponse) =>
          set(
            { projectList: response.data, projectListInit: true },
            false,
            'useFetchProjectList/success',
          ),
      }),
  })),
  shallow,
);

expose('project', useProjectStore);
