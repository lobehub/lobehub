// Fixture: the payload shapes are declared in the types package and imported.
import type { ProjectDetail, ProjectListItem, ProjectListResponse } from '@lobechat/types';

import { defineReplica } from '@/libs/replica';

export const projectListResource = defineReplica<
  Record<string, never>,
  ProjectListItem[],
  ProjectListResponse
>({
  key: () => 'all',
  name: 'projectList',
  storage: 'indexedDB',
  version: 1,
});

export const pickActive = (detail: ProjectDetail): ProjectListItem | undefined =>
  detail.status === 'active' ? detail : undefined;
