import { defineReplica } from '@/libs/replica';
import type { projectService } from '@/services/project';

type ProjectListResponse = Awaited<ReturnType<typeof projectService.listAll>>;
type ProjectDetailResponse = Awaited<ReturnType<typeof projectService.detail>>;
type ProjectOverviewResponse = Awaited<ReturnType<typeof projectService.listOverviews>>;
type ProjectListRow = ProjectListResponse['data'][number];
/**
 * List and detail replicas share one project entity, and only `project.list`
 * joins the main agent's display meta, so rows from create / detail lack it.
 */
export type ProjectListItem = Omit<ProjectListRow, 'coordinatorAgent'> &
  Partial<Pick<ProjectListRow, 'coordinatorAgent'>>;
export type ProjectDetail = ProjectDetailResponse['data'];
/** Folder-card content of one project; a project with no row has none of it yet. */
export type ProjectOverview = ProjectOverviewResponse['data'][number];
/** Overviews by project id. */
export type ProjectOverviewMap = Record<string, ProjectOverview>;

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

/** Folder-card content of every project in scope (`projectOverviewMap.all`), by project id. */
export const projectOverviewResource = defineReplica<
  Record<string, never>,
  ProjectOverviewMap,
  ProjectOverviewResponse
>({
  key: () => PROJECT_LIST_KEY,
  name: 'projectOverview',
  storage: 'indexedDB',
  version: 1,
});
