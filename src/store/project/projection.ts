import { defineReplica } from '@/libs/replica';
import type { projectService } from '@/services/project';

type ProjectListResponse = Awaited<ReturnType<typeof projectService.listAll>>;
type ProjectDetailResponse = Awaited<ReturnType<typeof projectService.detail>>;
export type ProjectListItem = ProjectListResponse['data'][number];
export type ProjectDetail = ProjectDetailResponse['data'];

/** The sidebar / list page reads every project, so the list has one entry. */
export const PROJECT_LIST_KEY = 'all';

/** Every project of the active scope (`projectListMap.all`). */
export const projectListResource = defineReplica<
  Record<string, never>,
  ProjectListItem[],
  ProjectListResponse
>({
  key: () => PROJECT_LIST_KEY,
  name: 'projectList',
  storage: 'indexedDB',
  version: 1,
});

/** One project page, keyed by the route param (id or slug) (`projectDetailMap[idOrSlug]`). */
export const projectDetailResource = defineReplica<string, ProjectDetail, ProjectDetailResponse>({
  key: (idOrSlug) => idOrSlug,
  name: 'projectDetail',
  storage: 'indexedDB',
  version: 1,
});
