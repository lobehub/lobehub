import { defineReplica } from '@/libs/replica';
import type { projectWorkingDirectoryService } from '@/services/projectWorkingDirectory';

/**
 * Replica resources for the project-env surfaces (directories, their
 * conversations, and the environments they resolve through).
 *
 * Every entry key is a primitive so a mount that asks for the same thing twice
 * produces the same SWR key: the sync key carries `params` verbatim, and a
 * freshly built object/array would refetch on each render.
 */

/** One entry covers every project of the scope when no project is named. */
export const ALL_PROJECTS_KEY = 'all';

type ProjectTopicsResponse = Awaited<
  ReturnType<typeof projectWorkingDirectoryService.listProjectTopics>
>;
export type ProjectTopic = ProjectTopicsResponse['data'][number];

type DirectoriesResponse = Awaited<ReturnType<typeof projectWorkingDirectoryService.list>>;
export type ProjectDirectory = DirectoriesResponse['data'][number];

type EnvironmentsResponse = Awaited<
  ReturnType<typeof projectWorkingDirectoryService.listEnvironments>
>;
export type ProjectEnvironment = EnvironmentsResponse['data'][number];

type DirectoryTopicsResponse = Awaited<
  ReturnType<typeof projectWorkingDirectoryService.listTopics>
>;
export type DirectoryTopic = DirectoryTopicsResponse['data'][number];

/** Conversations of one project (`projectTopicsMap[projectId]`). */
export const projectTopicsResource = defineReplica<string, ProjectTopic[], ProjectTopicsResponse>({
  key: (projectId) => projectId,
  name: 'projectTopics',
  storage: 'indexedDB',
  version: 1,
});

/** Directories of one project, or of every project (`directoriesMap[projectId | 'all']`). */
export const projectDirectoriesResource = defineReplica<
  string,
  ProjectDirectory[],
  DirectoriesResponse
>({
  key: (projectId) => projectId,
  name: 'projectDirectories',
  storage: 'indexedDB',
  version: 1,
});

/** Environments of one project, or of every project (`environmentsMap[projectId | 'all']`). */
export const projectEnvironmentsResource = defineReplica<
  string,
  ProjectEnvironment[],
  EnvironmentsResponse
>({
  key: (projectId) => projectId,
  name: 'projectEnvironments',
  storage: 'indexedDB',
  version: 1,
});

/** Conversations bound to one directory (`directoryTopicsMap[directoryId]`). */
export const directoryTopicsResource = defineReplica<
  string,
  DirectoryTopic[],
  DirectoryTopicsResponse
>({
  key: (directoryId) => directoryId,
  name: 'directoryTopics',
  storage: 'indexedDB',
  version: 1,
});

/**
 * The union of several directories' conversations, keyed by the sorted id set
 * so two mounts that name the same directories share one entry and one fetch.
 */
export const environmentTopicsResource = defineReplica<
  string,
  DirectoryTopic[],
  DirectoryTopicsResponse
>({
  key: (directoryIdsKey) => directoryIdsKey,
  name: 'environmentTopics',
  storage: 'indexedDB',
  version: 1,
});

const DIRECTORY_IDS_SEPARATOR = '|';

/** Stable key for a set of directory ids, independent of the caller's order. */
export const directoryIdsKey = (directoryIds: string[]) =>
  [...directoryIds].sort().join(DIRECTORY_IDS_SEPARATOR);

/** The ids a {@link directoryIdsKey} entry was built from (fetcher side). */
export const directoryIdsFromKey = (directoryIdsKey: string) =>
  directoryIdsKey ? directoryIdsKey.split(DIRECTORY_IDS_SEPARATOR) : [];
