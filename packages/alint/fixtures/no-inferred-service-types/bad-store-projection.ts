// Fixture: a store projection that infers its row types from the client service.
import { defineReplica } from '@/libs/replica';
import type { projectService } from '@/services/project';

// alint-expect
type ProjectListResponse = Awaited<ReturnType<typeof projectService.listAll>>;
// alint-expect
type ProjectDetailResponse = Awaited<ReturnType<typeof projectService.detail>>;
type ProjectListRow = ProjectListResponse['data'][number];

export type ProjectListItem = Omit<ProjectListRow, 'coordinatorAgent'> &
  Partial<Pick<ProjectListRow, 'coordinatorAgent'>>;
export type ProjectDetail = ProjectDetailResponse['data'];

export const projectDetailResource = defineReplica<string, ProjectDetail, ProjectDetailResponse>({
  key: (idOrSlug) => idOrSlug,
  name: 'projectDetail',
  storage: 'indexedDB',
  version: 1,
});
