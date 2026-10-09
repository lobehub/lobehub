import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';

import { getActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import {
  arrayEntity,
  createReplicaSlice,
  createReplicaState,
  linkReplicaEntity,
  recordLens,
  type ReplicaState,
  type ReplicaSyncResult,
  singleEntity,
} from '@/libs/replica';
import { projectService } from '@/services/project';
import { createDevtools } from '@/store/middleware/createDevtools';
import { expose } from '@/store/middleware/expose';

import {
  PROJECT_LIST_KEY,
  type ProjectDetail,
  projectDetailResource,
  type ProjectListItem,
  projectListResource,
} from './projection';

export type { ProjectDetail, ProjectListItem } from './projection';

export interface ProjectStoreState {
  /** Project pages by route param (id or slug). */
  projectDetailMap: Record<string, ProjectDetail>;
  /** Replica bookkeeping for `projectDetailMap`. */
  projectDetailReplica: ReplicaState<ProjectDetail>;
  /** `projectListMap.all`: every project of the active scope. */
  projectListMap: Record<string, ProjectListItem[]>;
  /** Replica bookkeeping for `projectListMap`. */
  projectListReplica: ReplicaState<ProjectListItem[]>;
}

interface ProjectStore extends ProjectStoreState {
  createProject: (input: {
    identifier: string;
    name: string;
    slug?: string;
  }) => Promise<ProjectListItem>;
  deleteProject: (id: string) => Promise<void>;
  refreshProjectList: () => Promise<void>;
  updateProject: (
    id: string,
    input: Parameters<typeof projectService.update>[1],
  ) => Promise<ProjectListItem>;
  /** Fetch orchestration only; read the value with `useCurrentProjectDetail`. */
  useFetchProjectDetail: (idOrSlug?: string) => ReplicaSyncResult;
  /** Fetch orchestration only; read the rows with `useCurrentProjectList`. */
  useFetchProjectList: (enabled?: boolean) => ReplicaSyncResult;
}

export const initialProjectState: ProjectStoreState = {
  projectDetailMap: {},
  projectDetailReplica: createReplicaState(),
  projectListMap: {},
  projectListReplica: createReplicaState(),
};

const LIST_PARAMS = {} as Record<string, never>;

const devtools = createDevtools('project');

export const useProjectStore = createWithEqualityFn<ProjectStore>()(
  devtools((set, get) => {
    const list = createReplicaSlice(projectListResource, {
      actionPrefix: 'project/list',
      entity: arrayEntity<ProjectListItem>((project) => project.id),
      fetcher: () => projectService.listAll(),
      get,
      merge: (response) => response.data,
      set,
      stateKey: 'projectListReplica',
      view: recordLens<ProjectStore, ProjectListItem[]>('projectListMap'),
    });
    const detail = createReplicaSlice(projectDetailResource, {
      actionPrefix: 'project/detail',
      entity: singleEntity<ProjectDetail, ProjectListItem>((project) => project.id, {
        get: (value) => value.project,
        set: (value, project) => ({ ...value, project }),
      }),
      fetcher: (idOrSlug) => projectService.detail(idOrSlug),
      get,
      merge: (response) => response.data,
      set,
      stateKey: 'projectDetailReplica',
      view: recordLens<ProjectStore, ProjectDetail>('projectDetailMap'),
    });
    // The same project lives in the list and in every loaded project page.
    const projectEntity = linkReplicaEntity<ProjectListItem>([list, detail]);

    const refreshList = () => list.revalidate(PROJECT_LIST_KEY);

    return {
      ...initialProjectState,
      createProject: async (input) => {
        const response = await projectService.create(input, getActiveWorkspaceId());
        const project = response.data;
        list.update(PROJECT_LIST_KEY, (items) =>
          items && !items.some((item) => item.id === project.id) ? [project, ...items] : items,
        );
        void refreshList();
        return project;
      },
      deleteProject: async (id) => {
        await projectService.delete(id);
        projectEntity.remove(id);
        void refreshList();
      },
      refreshProjectList: async () => {
        await refreshList();
      },
      updateProject: async (id, input) => {
        const response = await projectEntity.optimistic(
          id,
          (project) => ({ ...project, ...input }),
          () => projectService.update(id, input),
        );
        // Server-owned fields (updatedAt, slug normalisation) land in every copy.
        projectEntity.update(id, (project) => ({ ...project, ...response.data }));
        void refreshList();
        return response.data;
      },
      useFetchProjectDetail: (idOrSlug) => detail.useSync(idOrSlug || null),
      useFetchProjectList: (enabled = true) => list.useSync(LIST_PARAMS, { enabled }),
    };
  }),
  shallow,
);

expose('project', useProjectStore);

const EMPTY_PROJECTS: ProjectListItem[] = [];

export const useCurrentProjectList = () =>
  useProjectStore((state) => state.projectListMap[PROJECT_LIST_KEY] ?? EMPTY_PROJECTS);

export const useCurrentProjectDetail = (idOrSlug?: string) =>
  useProjectStore((state) => (idOrSlug ? state.projectDetailMap[idOrSlug] : undefined));
