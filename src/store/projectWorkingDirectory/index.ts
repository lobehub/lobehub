import type { StoreApi } from 'zustand';
import { shallow } from 'zustand/shallow';
import { createWithEqualityFn, type UseBoundStoreWithEqualityFn } from 'zustand/traditional';

import {
  createReplicaSlice,
  createReplicaState,
  recordLens,
  type ReplicaState,
  type ReplicaSyncResult,
} from '@/libs/replica';
import { projectWorkingDirectoryService } from '@/services/projectWorkingDirectory';

import {
  ALL_PROJECTS_KEY,
  directoryIdsFromKey,
  directoryIdsKey,
  type DirectoryTopic,
  directoryTopicsResource,
  environmentTopicsResource,
  projectDirectoriesResource,
  type ProjectDirectory,
  type ProjectEnvironment,
  projectEnvironmentsResource,
  type ProjectTopic,
  projectTopicsResource,
} from './projection';

export type {
  DirectoryTopic,
  ProjectDirectory,
  ProjectEnvironment,
  ProjectTopic,
} from './projection';

/** Poll cadence for the project topic list while a conversation is in flight. */
export const PROJECT_TOPICS_POLL_INTERVAL = 5000;

/** Statuses the server can still move on its own. */
const IN_FLIGHT_STATUSES = new Set(['running', 'waitingForHuman']);

/** Whether a project still has a conversation the server may still be updating. */
const hasInFlightTopic = (topics: ProjectTopic[] | undefined) =>
  !!topics?.some((topic) => IN_FLIGHT_STATUSES.has(topic.status ?? ''));

/**
 * What a `useFetch*` hook reports. It never carries rows — read them with the
 * matching `use*` selector, which is the only place the data lives.
 */
export interface ProjectListSyncResult extends ReplicaSyncResult {
  /**
   * The rows have materialized (persisted replica or network). `isValidating`
   * cannot tell a re-fetch from a first load, but surfaces that gate on "there
   * is nothing to show yet" must not flash their empty state on every
   * revalidation — nor before the first fetch has even been scheduled.
   */
  hasData: boolean;
}

export interface ProjectDirectoryStoreState {
  /** Directory rows by project (`all` = every project of the scope). */
  directoriesMap: Record<string, ProjectDirectory[]>;
  /** Replica bookkeeping for `directoriesMap`. */
  directoriesReplica: ReplicaState<ProjectDirectory[]>;
  /** Conversations bound to one directory, by directory id. */
  directoryTopicsMap: Record<string, DirectoryTopic[]>;
  /** Replica bookkeeping for `directoryTopicsMap`. */
  directoryTopicsReplica: ReplicaState<DirectoryTopic[]>;
  /** Environments by project (`all` = every environment of the scope). */
  environmentsMap: Record<string, ProjectEnvironment[]>;
  /** Replica bookkeeping for `environmentsMap`. */
  environmentsReplica: ReplicaState<ProjectEnvironment[]>;
  /** The union of several directories' conversations, by directory-id set. */
  environmentTopicsMap: Record<string, DirectoryTopic[]>;
  /** Replica bookkeeping for `environmentTopicsMap`. */
  environmentTopicsReplica: ReplicaState<DirectoryTopic[]>;
  /** Conversations of one project, by project id. */
  projectTopicsMap: Record<string, ProjectTopic[]>;
  /** Replica bookkeeping for `projectTopicsMap`. */
  projectTopicsReplica: ReplicaState<ProjectTopic[]>;
}

type Service = typeof projectWorkingDirectoryService;
type ServiceParams<Name extends keyof Service> = Parameters<Service[Name]>;
/** A service call's `data`, so a store action never widens its result to `unknown`. */
type ServiceData<Name extends keyof Service> =
  Awaited<ReturnType<Service[Name]>> extends { data: infer TData } ? TData : never;

interface ProjectDirectoryStore extends ProjectDirectoryStoreState {
  /** Bind a conversation to a directory of a project. */
  associateTopic: (
    ...args: ServiceParams<'associateTopic'>
  ) => Promise<ServiceData<'associateTopic'>>;
  /** Link an environment to a project. */
  attachEnvironment: (...args: ServiceParams<'attachEnvironment'>) => Promise<void>;
  /** Register a working directory, absorbing the conversations it covers. */
  bind: (...args: ServiceParams<'bind'>) => Promise<ServiceData<'bind'>>;
  /** Open a project conversation outside any directory binding. */
  createProjectTopic: (
    ...args: ServiceParams<'createProjectTopic'>
  ) => Promise<ServiceData<'createProjectTopic'>>;
  /** Create or rename an environment. */
  saveEnvironment: (
    ...args: ServiceParams<'saveEnvironment'>
  ) => Promise<ServiceData<'saveEnvironment'>>;
  /** Start a conversation inside one directory. */
  startTopic: (id: string, agentId: string, title: string) => Promise<ServiceData<'startTopic'>>;
  /** Fetch orchestration only; read the rows with `useProjectDirectories`. */
  useFetchDirectories: (projectId?: string, enabled?: boolean) => ProjectListSyncResult;
  /** Fetch orchestration only; read the rows with `useDirectoryTopics`. */
  useFetchDirectoryTopics: (id?: string) => ProjectListSyncResult;
  /** Fetch orchestration only; read the rows with `useProjectEnvironments`. */
  useFetchEnvironments: (projectId?: string) => ProjectListSyncResult;
  /** Fetch orchestration only; read the rows with `useEnvironmentTopics`. */
  useFetchEnvironmentTopics: (directoryIds: string[]) => ProjectListSyncResult;
  /** Fetch orchestration only; read the rows with `useProjectTopics`. */
  useFetchProjectTopics: (projectId?: string) => ProjectListSyncResult;
}

export const initialProjectDirectoryState: ProjectDirectoryStoreState = {
  directoriesMap: {},
  directoriesReplica: createReplicaState(),
  directoryTopicsMap: {},
  directoryTopicsReplica: createReplicaState(),
  environmentTopicsMap: {},
  environmentTopicsReplica: createReplicaState(),
  environmentsMap: {},
  environmentsReplica: createReplicaState(),
  projectTopicsMap: {},
  projectTopicsReplica: createReplicaState(),
};

/**
 * The `useFetch*` actions read their own store to decide what to report, so the
 * bound hook is referenced before its initializer finishes. Annotate the
 * variable: without it the equality-fn overload has to infer its store-mutator
 * list *from* that initializer and becomes circular (`TS7022`), which would
 * quietly degrade every selector in this module to `any`.
 */
export const useProjectDirectoryStore: UseBoundStoreWithEqualityFn<
  StoreApi<ProjectDirectoryStore>
> = createWithEqualityFn<ProjectDirectoryStore>()((set, get) => {
  const directories = createReplicaSlice(projectDirectoriesResource, {
    actionPrefix: 'projectWorkingDirectory/directories',
    fetcher: (key) =>
      projectWorkingDirectoryService.list(key === ALL_PROJECTS_KEY ? undefined : key),
    get,
    merge: (response) => response.data,
    set,
    stateKey: 'directoriesReplica',
    view: recordLens<ProjectDirectoryStore, ProjectDirectory[]>('directoriesMap'),
  });
  const environments = createReplicaSlice(projectEnvironmentsResource, {
    actionPrefix: 'projectWorkingDirectory/environments',
    fetcher: (key) =>
      projectWorkingDirectoryService.listEnvironments(key === ALL_PROJECTS_KEY ? undefined : key),
    get,
    merge: (response) => response.data,
    set,
    stateKey: 'environmentsReplica',
    view: recordLens<ProjectDirectoryStore, ProjectEnvironment[]>('environmentsMap'),
  });
  const projectTopics = createReplicaSlice(projectTopicsResource, {
    actionPrefix: 'projectWorkingDirectory/projectTopics',
    fetcher: (projectId) => projectWorkingDirectoryService.listProjectTopics(projectId),
    get,
    merge: (response) => response.data,
    set,
    stateKey: 'projectTopicsReplica',
    view: recordLens<ProjectDirectoryStore, ProjectTopic[]>('projectTopicsMap'),
  });
  const directoryTopics = createReplicaSlice(directoryTopicsResource, {
    actionPrefix: 'projectWorkingDirectory/directoryTopics',
    fetcher: (directoryId) => projectWorkingDirectoryService.listTopics(directoryId),
    get,
    merge: (response) => response.data,
    set,
    stateKey: 'directoryTopicsReplica',
    view: recordLens<ProjectDirectoryStore, DirectoryTopic[]>('directoryTopicsMap'),
  });
  const environmentTopics = createReplicaSlice(environmentTopicsResource, {
    actionPrefix: 'projectWorkingDirectory/environmentTopics',
    fetcher: (idsKey) =>
      projectWorkingDirectoryService.listEnvironmentTopics(directoryIdsFromKey(idsKey)),
    get,
    merge: (response) => response.data,
    set,
    stateKey: 'environmentTopicsReplica',
    view: recordLens<ProjectDirectoryStore, DirectoryTopic[]>('environmentTopicsMap'),
  });

  return {
    ...initialProjectDirectoryState,

    createProjectTopic: async (input) => {
      const result = await projectWorkingDirectoryService.createProjectTopic(input);
      await projectTopics.revalidate(input.projectId);
      return result.data;
    },
    associateTopic: async (input) => {
      const result = await projectWorkingDirectoryService.associateTopic(input);
      await Promise.all([
        projectTopics.revalidate(input.projectId),
        // The topic now points at a directory, so every projection that lists
        // it (one directory's, or a set of directories') is stale too.
        directoryTopics.revalidate(),
        environmentTopics.revalidate(),
      ]);
      return result.data;
    },
    saveEnvironment: async (input) => {
      const result = await projectWorkingDirectoryService.saveEnvironment(input);
      // One environment is shared by every project that lists it, and its name
      // is denormalized into the directory rows — so both resources converge
      // on the new value, for every loaded project.
      await Promise.all([environments.revalidate(), directories.revalidate()]);
      return result.data;
    },
    attachEnvironment: async (projectId, environmentId) => {
      await projectWorkingDirectoryService.attachEnvironment(projectId, environmentId);
      await Promise.all([
        environments.revalidate(projectId),
        // The scope-wide list gained the environment instanced by the attach.
        environments.revalidate(ALL_PROJECTS_KEY),
      ]);
    },
    bind: async (input) => {
      const result = await projectWorkingDirectoryService.bind(input);
      // One bind writes a directory, its environment and the conversations it
      // absorbs — the replica resources are the only place that knows which
      // projections those land in.
      await Promise.all([
        projectTopics.revalidate(input.projectId),
        directories.revalidate(ALL_PROJECTS_KEY),
        directories.revalidate(input.projectId),
        environmentTopics.revalidate(),
        environments.revalidate(),
        environments.revalidate(input.projectId),
      ]);
      return result.data;
    },
    startTopic: async (id, agentId, title) => {
      const result = await projectWorkingDirectoryService.startTopic({ agentId, id, title });
      await Promise.all([
        projectTopics.revalidate(),
        directoryTopics.revalidate(id),
        environmentTopics.revalidate(),
      ]);
      return result.data;
    },

    useFetchProjectTopics: (projectId) => {
      // Poll from a reactive boolean derived from the folded rows: SWR's
      // function-form `refreshInterval` is only re-evaluated after a timer
      // fires, so a first call that returns 0 never schedules one at all.
      const shouldPoll = useProjectDirectoryStore((state) =>
        projectId ? hasInFlightTopic(state.projectTopicsMap[projectId]) : false,
      );
      const sync = projectTopics.useSync(projectId, {
        refreshInterval: shouldPoll ? PROJECT_TOPICS_POLL_INTERVAL : 0,
      });
      const hasData = useProjectDirectoryStore((state) =>
        projectId ? state.projectTopicsMap[projectId] !== undefined : false,
      );
      return { ...sync, hasData };
    },
    useFetchDirectories: (projectId, enabled = true) => {
      const key = projectId ?? ALL_PROJECTS_KEY;
      const sync = directories.useSync(key, { enabled });
      const hasData = useProjectDirectoryStore((state) => state.directoriesMap[key] !== undefined);
      return { ...sync, hasData };
    },
    useFetchEnvironments: (projectId) => {
      const key = projectId ?? ALL_PROJECTS_KEY;
      const sync = environments.useSync(key);
      const hasData = useProjectDirectoryStore((state) => state.environmentsMap[key] !== undefined);
      return { ...sync, hasData };
    },
    useFetchDirectoryTopics: (id) => {
      const sync = directoryTopics.useSync(id);
      const hasData = useProjectDirectoryStore((state) =>
        id ? state.directoryTopicsMap[id] !== undefined : false,
      );
      return { ...sync, hasData };
    },
    useFetchEnvironmentTopics: (directoryIds) => {
      const key = directoryIdsKey(directoryIds);
      const sync = environmentTopics.useSync(key, { enabled: directoryIds.length > 0 });
      const hasData = useProjectDirectoryStore(
        (state) => state.environmentTopicsMap[key] !== undefined,
      );
      return { ...sync, hasData };
    },
  };
}, shallow);

const EMPTY_DIRECTORY_TOPICS: DirectoryTopic[] = [];
const EMPTY_DIRECTORIES: ProjectDirectory[] = [];
const EMPTY_ENVIRONMENTS: ProjectEnvironment[] = [];
const EMPTY_PROJECT_TOPICS: ProjectTopic[] = [];

/** Stable-identity empty lists: an absent entry and an empty one read the same. */
const rowsOf = <T>(map: Record<string, T[]>, key: string | undefined, empty: T[]): T[] =>
  (key ? map[key] : undefined) ?? empty;

/** Conversations of one project. */
export const useProjectTopics = (projectId?: string) =>
  useProjectDirectoryStore((state) =>
    rowsOf(state.projectTopicsMap, projectId, EMPTY_PROJECT_TOPICS),
  );

/** Directories of one project, or every directory of the scope. */
export const useProjectDirectories = (projectId?: string) =>
  useProjectDirectoryStore((state) =>
    rowsOf(state.directoriesMap, projectId ?? ALL_PROJECTS_KEY, EMPTY_DIRECTORIES),
  );

/** Environments of one project, or every environment of the scope. */
export const useProjectEnvironments = (projectId?: string) =>
  useProjectDirectoryStore((state) =>
    rowsOf(state.environmentsMap, projectId ?? ALL_PROJECTS_KEY, EMPTY_ENVIRONMENTS),
  );

/** Conversations bound to one directory. */
export const useDirectoryTopics = (directoryId?: string) =>
  useProjectDirectoryStore((state) =>
    rowsOf(state.directoryTopicsMap, directoryId, EMPTY_DIRECTORY_TOPICS),
  );

/** Conversations bound to any of these directories. */
export const useEnvironmentTopics = (directoryIds: string[]) =>
  useProjectDirectoryStore((state) =>
    rowsOf(state.environmentTopicsMap, directoryIdsKey(directoryIds), EMPTY_DIRECTORY_TOPICS),
  );
